from __future__ import annotations
import httpx
from ..config import get_settings

class TwilioSMS:
    def __init__(self):
        self.settings = get_settings()
        if not self.settings.twilio_enabled:
            raise RuntimeError("Active Twilio credentials and a sender or Messaging Service SID are required")
    async def send(self, to: str, body: str) -> dict:
        form = {"To": to, "Body": body}
        if self.settings.twilio_messaging_service_sid:
            form["MessagingServiceSid"] = self.settings.twilio_messaging_service_sid
        else:
            form["From"] = self.settings.twilio_from_number
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.settings.twilio_account_sid}/Messages.json"
        async with httpx.AsyncClient(timeout=10, auth=(self.settings.twilio_account_sid, self.settings.twilio_auth_token)) as client:
            response = await client.post(url, data=form)
            response.raise_for_status()
            return response.json()
