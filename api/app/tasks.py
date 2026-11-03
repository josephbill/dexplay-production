from __future__ import annotations
import logging
import httpx
from .celery_app import celery_app
from .config import get_settings

log = logging.getLogger("dexplay.tasks")

@celery_app.task(bind=True, autoretry_for=(httpx.HTTPError,), retry_backoff=True, retry_kwargs={"max_retries": 5})
def send_transactional_sms(self, to: str, message: str, request_id: str = "unknown"):
    settings = get_settings()
    if not settings.twilio_enabled:
        log.error("sms.send_unavailable request_id=%s task_id=%s",
                  request_id, self.request.id)
        raise RuntimeError("SMS is not enabled: active Twilio credentials and sender configuration are required")
    fields = {"To": to, "Body": message}
    if settings.twilio_messaging_service_sid:
        fields["MessagingServiceSid"] = settings.twilio_messaging_service_sid
    else:
        fields["From"] = settings.twilio_from_number
    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json"
    log.info("sms.send_started request_id=%s task_id=%s retry=%s",
             request_id, self.request.id, self.request.retries)
    try:
        response = httpx.post(url, data=fields, auth=(settings.twilio_account_sid, settings.twilio_auth_token), timeout=10)
        response.raise_for_status()
        body = response.json()
    except Exception as exc:
        log.error("sms.send_failed request_id=%s task_id=%s error_type=%s",
                  request_id, self.request.id, type(exc).__name__)
        raise
    log.info("sms.send_completed request_id=%s task_id=%s status=%s",
             request_id, self.request.id, body["status"])
    return {"sid": body["sid"], "status": body["status"]}
