from __future__ import annotations
import asyncio, hashlib, hmac, logging, secrets, uuid
from datetime import datetime, timedelta, timezone
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from phonenumbers import NumberParseException
import phonenumbers
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from .agents import adaptive
from .config import get_settings
from .db import SessionLocal, get_db
from .models import Account, ActivationClaim, CuratedResource, DeviceKey, SessionRecord, WebhookEvent
from .models.entities import new_key
from .orchestrator import orchestrate
from .schemas import ClaimRequest, FreeAnalysisRequest, KeyActivationRequest, SubscriptionRequest, SyncRequest
from .security import decrypt_payload, encrypt_payload, generate_api_key, hash_api_key, hash_claim
from .services.paypal import PayPalClient

log = logging.getLogger("dexplay.api")
settings = get_settings()
app = FastAPI(title="DexPlay Cloud API", version="1.0.0", docs_url=None if settings.app_env == "production" else "/docs",
              redoc_url=None if settings.app_env == "production" else "/redoc")
if not settings.cors_origins:
    raise RuntimeError("ALLOWED_ORIGINS must list the deployed PWA HTTPS origin")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "X-Device-Key"])

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=()"
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith(("/sync", "/analysis", "/paypal", "/privacy")) else "no-cache"
    return response

async def authenticated_device(x_device_key: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    if not x_device_key or len(x_device_key) != 12 or not x_device_key.isalnum():
        raise HTTPException(401, "A valid 12-character device key is required")
    device = (await db.execute(select(DeviceKey).where(DeviceKey.key_hash == hash_api_key(x_device_key), DeviceKey.active.is_(True)))).scalar_one_or_none()
    if not device:
        raise HTTPException(401, "Device key is invalid or revoked")
    account = await db.get(Account, device.account_id)
    if not account or account.subscription_state != "active":
        raise HTTPException(403, "Cloud access is not active. Local offline practice remains available.")
    device.last_used_at = datetime.now(timezone.utc)
    return device, account

@app.get("/health/live")
async def liveness():
    return {"status": "live"}

@app.get("/health/ready")
async def readiness(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(select(1))
        return {"status": "ready"}
    except Exception as exc:
        log.error("Readiness check failed: %s", type(exc).__name__)
        raise HTTPException(503, "Database unavailable") from exc

@app.post("/keys/activate")
async def activate_device(body: KeyActivationRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DeviceKey, Account).join(Account, Account.id == DeviceKey.account_id).where(
        DeviceKey.key_hash == hash_api_key(body.api_key), DeviceKey.active.is_(True)))
    pair = result.first()
    if not pair:
        raise HTTPException(401, "Device key is invalid or revoked")
    device, account = pair
    if account.subscription_state != "active":
        raise HTTPException(403, "Subscription is not active")
    device.label = body.device_label
    return {"valid": True, "account_type": account.profile_type, "subscription_state": account.subscription_state,
            "clinic_patient_limit": account.clinic_patient_limit}

@app.post("/sync")
async def sync(body: SyncRequest, auth=Depends(authenticated_device), db: AsyncSession = Depends(get_db)):
    device, account = auth
    session_id = str(body.session_data[-1].get("session_id") or body.patient_id or uuid.uuid4()) if body.session_data else str(body.patient_id or uuid.uuid4())
    payload = {"session_data": body.session_data, "profile": body.profile, "patient_id": body.patient_id,
               "usage_stats": body.usage_stats, "synced_at": datetime.now(timezone.utc).isoformat()}
    record = await db.get(SessionRecord, session_id)
    if record and record.account_id != account.id:
        raise HTTPException(409, "Session identifier is already in use")
    if record:
        record.encrypted_payload = encrypt_payload(payload)
    else:
        db.add(SessionRecord(id=session_id, account_id=account.id, encrypted_payload=encrypt_payload(payload)))
    await db.commit()
    count = await db.scalar(select(func.count()).select_from(SessionRecord).where(SessionRecord.account_id == account.id)) or 0
    usage = {**body.usage_stats, "free_sessions_count": max(int(body.usage_stats.get("free_sessions_count", 0)), count),
             "reports_viewed": int(body.usage_stats.get("reports_viewed", 0))}
    result = await orchestrate(session_data=body.session_data, profile=body.profile,
        subscription_state=account.subscription_state, usage_stats=usage,
        resource_preferences=body.resource_preferences,
        progress_summary={"session_count": count,
            "improvement_pct_30d": body.usage_stats.get("improvement_pct_30d", 0),
            "condition": body.profile.get("condition")},
        therapist_requested_reports=bool(body.usage_stats.get("therapist_requested_reports", False)))
    return result

async def enforce_free_analysis_limit(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    fingerprint = hmac.new(
        settings.api_key_pepper.encode(),
        client_ip.encode(),
        hashlib.sha256,
    ).hexdigest()
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        key = f"dexplay:free-analysis:{fingerprint}"
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 3600)
    except RedisError as exc:
        log.error("Free analysis rate limit unavailable: %s", type(exc).__name__)
        raise HTTPException(503, "Free session analysis is temporarily unavailable.") from exc
    finally:
        await redis.aclose()
    if count > 60:
        raise HTTPException(429, "Free session analysis limit reached. Try again later.")

@app.post("/analysis/free")
async def analyze_free_session(body: FreeAnalysisRequest, request: Request):
    await enforce_free_analysis_limit(request)
    session_data = [item.model_dump() for item in body.session_data]
    profile = body.profile.model_dump()
    try:
        result = await adaptive.run(
            session_data,
            profile,
            report_audiences=("patient",),
            brief_report=True,
        )
    except Exception as exc:
        log.error("Free session analysis failed: %s", type(exc).__name__)
        raise HTTPException(503, "Session analysis is temporarily unavailable; local game results are saved.") from exc
    return {
        "report": result.get("report", {}),
        "next_difficulty": result["next_difficulty"],
        "performance": {
            "rounds": len(session_data),
            "objects_placed": sum(item["objects_placed"] for item in session_data),
            "objects_total": sum(item["objects_total"] for item in session_data),
            "accuracy": round(sum(item["accuracy"] for item in session_data) / len(session_data), 3),
        },
        "new_resources": [],
        "resource_gaps": [],
    }

@app.get("/paypal/config")
async def paypal_config():
    return {"mode": settings.paypal_mode, "enabled": settings.paypal_enabled}

@app.post("/paypal/create_subscription")
async def create_subscription(body: SubscriptionRequest, db: AsyncSession = Depends(get_db)):
    if not settings.paypal_enabled:
        raise HTTPException(503, f"{settings.paypal_mode.title()} PayPal credentials, webhook, and active plan IDs are required")
    client = PayPalClient()
    if body.sms_consent and not body.phone_number:
        raise HTTPException(422, "A phone number is required when SMS consent is selected")
    if body.sms_consent and body.phone_number:
        try:
            parsed = phonenumbers.parse(body.phone_number, None)
            if not phonenumbers.is_valid_number(parsed): raise ValueError("invalid")
            phone = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        except (NumberParseException, ValueError) as exc:
            raise HTTPException(422, "Phone number must be a valid international number") from exc
    else:
        phone = None
    if body.sms_consent and not settings.twilio_enabled:
        raise HTTPException(503, "SMS is not configured with active Twilio credentials")
    activation_token = secrets.token_urlsafe(32)
    reference_id = secrets.token_urlsafe(18)
    claim = ActivationClaim(reference_id=reference_id, token_hash=hash_claim(activation_token), plan_type=body.plan, language=body.language,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
        phone_encrypted=encrypt_payload({"phone": phone}) if phone else None, sms_consent=body.sms_consent)
    db.add(claim)
    await db.commit()
    plan_id = settings.active_paypal_individual_plan_id if body.plan == "individual" else settings.active_paypal_clinic_plan_id
    return_url = f"{settings.public_origin.rstrip('/')}/payment/return?claim={activation_token}&lang={body.language}"
    try:
        response = await client.create_subscription(plan_id, reference_id, return_url)
    except httpx_error_types() as exc:
        await db.delete(claim); await db.commit()
        log.error("PayPal create subscription failed: %s", type(exc).__name__)
        raise HTTPException(502, "PayPal could not create the subscription") from exc
    claim.subscription_id = response["id"]
    await db.commit()
    approval = next((link["href"] for link in response.get("links", []) if link.get("rel") == "approve"), None)
    if not approval:
        raise HTTPException(502, "PayPal did not return an approval URL")
    return {"subscription_id": response["id"], "approval_url": approval,
            "activation_token": activation_token, "status": response.get("status")}

@app.post("/paypal/claim")
async def claim_subscription(body: ClaimRequest, db: AsyncSession = Depends(get_db)):
    claim = (await db.execute(select(ActivationClaim).where(ActivationClaim.token_hash == hash_claim(body.activation_token)).with_for_update())).scalar_one_or_none()
    if not claim or claim.expires_at < datetime.now(timezone.utc):
        raise HTTPException(410, "Activation link is invalid or expired")
    if claim.claimed_at:
        raise HTTPException(409, "Activation keys have already been claimed")
    if not claim.encrypted_keys:
        return Response(status_code=202, content='{"status":"pending"}', media_type="application/json")
    keys = decrypt_payload(claim.encrypted_keys)["keys"]
    claim.encrypted_keys = None
    claim.claimed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status":"active", "keys":keys, "account_type":claim.plan_type}

@app.post("/paypal/webhook")
async def paypal_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    event = await request.json()
    try:
        verified = await PayPalClient().verify_webhook(dict(request.headers), event)
    except Exception as exc:
        log.error("PayPal webhook verification error: %s", type(exc).__name__)
        raise HTTPException(502, "Could not verify PayPal event") from exc
    if not verified:
        raise HTTPException(400, "PayPal webhook signature verification failed")
    event_id = event.get("id")
    event_type = event.get("event_type")
    if not event_id or not event_type:
        raise HTTPException(400, "Malformed PayPal webhook event")
    if await db.get(WebhookEvent, event_id):
        return {"received": True, "duplicate": True}
    resource = event.get("resource", {})
    subscription_id = resource.get("id") if event_type.startswith("BILLING.SUBSCRIPTION.") else resource.get("billing_agreement_id")
    if event_type == "BILLING.SUBSCRIPTION.ACTIVATED":
        ref = resource.get("custom_id")
        claim = await db.get(ActivationClaim, ref) if ref else None
        if claim and claim.expires_at > datetime.now(timezone.utc):
            account = Account(profile_type=claim.plan_type, subscription_state="active",
                paypal_subscription_id=subscription_id, clinic_patient_limit=50 if claim.plan_type == "clinic" else 1,
                phone_encrypted=claim.phone_encrypted, sms_consent=claim.sms_consent)
            db.add(account)
            await db.flush()
            count = 50 if claim.plan_type == "clinic" else 1
            keys = []
            for idx in range(count):
                raw = generate_api_key()
                keys.append({"label": f"patient-{idx + 1}" if count > 1 else "device", "api_key": raw})
                db.add(DeviceKey(account_id=account.id, key_hash=hash_api_key(raw), label=keys[-1]["label"]))
            claim.account_id = account.id
            claim.subscription_id = subscription_id
            claim.encrypted_keys = encrypt_payload({"keys":keys})
            if account.phone_encrypted and account.sms_consent:
                phone = decrypt_payload(account.phone_encrypted)["phone"]
                from .tasks import send_transactional_sms
                try:
                    send_transactional_sms.delay(phone, localized_message(claim.language, "activated"))
                except Exception as exc:
                    log.error("Could not enqueue activation SMS: %s", type(exc).__name__)
        else:
            log.error("Verified activation lacked a valid pending claim")
    elif event_type in ("BILLING.SUBSCRIPTION.CANCELLED", "BILLING.SUBSCRIPTION.EXPIRED", "BILLING.SUBSCRIPTION.SUSPENDED", "BILLING.SUBSCRIPTION.PAYMENT.FAILED"):
        account = (await db.execute(select(Account).where(Account.paypal_subscription_id == subscription_id).with_for_update())).scalar_one_or_none()
        if account:
            account.subscription_state = "payment_failed" if event_type.endswith("PAYMENT.FAILED") else "lapsed"
            keys = (await db.execute(select(DeviceKey).where(DeviceKey.account_id == account.id))).scalars().all()
            for device in keys: device.active = False
    db.add(WebhookEvent(event_id=event_id, event_type=event_type))
    await db.commit()
    return {"received":True}

@app.get("/clinic/dashboard")
async def clinic_dashboard(auth=Depends(authenticated_device), db: AsyncSession = Depends(get_db)):
    _, account = auth
    if account.profile_type != "clinic":
        raise HTTPException(403, "Clinic subscription required")
    rows = (await db.execute(select(SessionRecord).where(SessionRecord.account_id == account.id).order_by(SessionRecord.updated_at.desc()).limit(500))).scalars().all()
    patients: dict[str, list] = {}
    for row in rows:
        payload = decrypt_payload(row.encrypted_payload)
        key = str(payload.get("patient_id") or "unassigned")
        patients.setdefault(key, []).append(payload)
    return {"patient_limit":account.clinic_patient_limit, "patient_count":len(patients), "patients":patients}

@app.get("/privacy/export")
async def export_account(auth=Depends(authenticated_device), db: AsyncSession = Depends(get_db)):
    _, account = auth
    rows = (await db.execute(select(SessionRecord).where(SessionRecord.account_id == account.id))).scalars().all()
    return {"account_type":account.profile_type, "subscription_state":account.subscription_state,
            "sessions":[decrypt_payload(row.encrypted_payload) for row in rows]}

@app.delete("/privacy/account", status_code=204)
async def delete_account(auth=Depends(authenticated_device), db: AsyncSession = Depends(get_db)):
    _, account = auth
    await db.delete(account)
    await db.commit()
    return Response(status_code=204)

def localized_message(language: str, kind: str) -> str:
    messages = {"en":"Your DexPlay subscription is active. Your access key is available in the app.",
        "es":"Tu suscripción de DexPlay está activa. Tu clave está disponible en la aplicación.",
        "hi":"आपकी DexPlay सदस्यता सक्रिय है। आपकी कुंजी ऐप में उपलब्ध है।",
        "zh":"您的 DexPlay 订阅已启用。访问密钥可在应用中查看。",
        "ar":"اشتراك DexPlay نشط. مفتاح الوصول متاح في التطبيق.",
        "sw":"Usajili wako wa DexPlay umewashwa. Ufunguo wako unapatikana kwenye programu.",
        "pt":"Sua assinatura DexPlay está ativa. A chave de acesso está disponível no aplicativo.",
        "fr":"Votre abonnement DexPlay est actif. Votre clé est disponible dans l’application.",
        "bn":"আপনার DexPlay সাবস্ক্রিপশন সক্রিয়। অ্যাপে আপনার অ্যাক্সেস কী রয়েছে।",
        "tl":"Aktibo na ang iyong DexPlay subscription. Makikita sa app ang iyong access key."}
    return messages.get(language, messages["en"])

def httpx_error_types():
    import httpx
    return (httpx.HTTPError, KeyError)
