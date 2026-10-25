from __future__ import annotations
import httpx
from .celery_app import celery_app
from .config import get_settings

@celery_app.task(bind=True, autoretry_for=(httpx.HTTPError,), retry_backoff=True, retry_kwargs={"max_retries": 5})
def send_transactional_sms(self, to: str, message: str):
    settings = get_settings()
    if not settings.twilio_enabled:
        raise RuntimeError("SMS is not enabled: active Twilio credentials and sender configuration are required")
    fields = {"To": to, "Body": message}
    if settings.twilio_messaging_service_sid:
        fields["MessagingServiceSid"] = settings.twilio_messaging_service_sid
    else:
        fields["From"] = settings.twilio_from_number
    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json"
    response = httpx.post(url, data=fields, auth=(settings.twilio_account_sid, settings.twilio_auth_token), timeout=10)
    response.raise_for_status()
    body = response.json()
    return {"sid": body["sid"], "status": body["status"]}
