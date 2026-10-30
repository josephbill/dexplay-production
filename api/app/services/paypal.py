from __future__ import annotations
import base64
import httpx
from ..config import get_settings

class PayPalClient:
    def __init__(self):
        self.settings = get_settings()
        if not self.settings.paypal_enabled:
            raise RuntimeError(f"{self.settings.paypal_mode.title()} PayPal credentials, webhook ID, and both plan IDs are required")
        self.base = self.settings.paypal_api_base
        self._token: str | None = None
    async def access_token(self) -> str:
        auth = base64.b64encode(f"{self.settings.active_paypal_client_id}:{self.settings.active_paypal_client_secret}".encode()).decode()
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(f"{self.base}/v1/oauth2/token", headers={"Authorization": f"Basic {auth}", "Accept":"application/json"}, data={"grant_type":"client_credentials"})
            response.raise_for_status()
            body = response.json()
        self._token = body["access_token"]
        return self._token
    async def request(self, method: str, path: str, body: dict | None = None, extra_headers: dict | None = None) -> dict:
        token = self._token or await self.access_token()
        headers = {"Authorization": f"Bearer {token}", "Content-Type":"application/json", **(extra_headers or {})}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.request(method, self.base + path, headers=headers, json=body)
            if response.status_code == 401:
                self._token = None
                token = await self.access_token()
                headers["Authorization"] = f"Bearer {token}"
                response = await client.request(method, self.base + path, headers=headers, json=body)
            response.raise_for_status()
            return response.json() if response.content else {}
    async def create_subscription(self, plan_id: str, reference_id: str, return_url: str) -> dict:
        return await self.request("POST", "/v1/billing/subscriptions", {
            "plan_id": plan_id, "custom_id": reference_id,
            "application_context": {"brand_name":"DexPlay", "locale":"en-US", "user_action":"SUBSCRIBE_NOW",
              "shipping_preference":"NO_SHIPPING", "return_url":return_url,
              "cancel_url":self.settings.public_origin.rstrip("/") + "/?payment=cancelled"}
        }, {"Prefer":"return=representation"})
    async def verify_webhook(self, headers: dict, event: dict) -> bool:
        result = await self.request("POST", "/v1/notifications/verify-webhook-signature", {
            "auth_algo":headers.get("paypal-auth-algo"),
            "cert_url":headers.get("paypal-cert-url"),
            "transmission_id":headers.get("paypal-transmission-id"),
            "transmission_sig":headers.get("paypal-transmission-sig"),
            "transmission_time":headers.get("paypal-transmission-time"),
            "webhook_id":self.settings.active_paypal_webhook_id,
            "webhook_event":event,
        })
        return result.get("verification_status") == "SUCCESS"
