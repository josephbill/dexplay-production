import base64
import os
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.update(
    {
        "APP_ENV": "staging",
        "PUBLIC_ORIGIN": "https://example.test",
        "DATABASE_URL": "postgresql+asyncpg://localhost/dexplay",
        "REDIS_URL": "redis://localhost:6379/0",
        "OPENAI_API_KEY": "paypal-flow-test-key",
        "DATA_ENCRYPTION_KEY": base64.urlsafe_b64encode(bytes(32)).decode(),
        "API_KEY_PEPPER": "paypal-flow-test-pepper-with-32-bytes",
        "ALLOWED_ORIGINS": "https://example.test",
    }
)

from app.config import Settings, get_settings

get_settings.cache_clear()

from app import main
from app.models import Account, ActivationClaim, DeviceKey, WebhookEvent
from app.schemas import ClaimRequest, KeyActivationRequest, SubscriptionRequest


class FakeResult:
    def __init__(self, value=None, pair=None):
        self.value = value
        self.pair = pair

    def scalar_one_or_none(self):
        return self.value

    def first(self):
        return self.pair


class FakePaymentDB:
    def __init__(self):
        self.claims = {}
        self.events = {}
        self.accounts = {}
        self.devices = []

    def add(self, item):
        if isinstance(item, ActivationClaim):
            self.claims[item.reference_id] = item
        elif isinstance(item, Account):
            self.accounts[item.id] = item
        elif isinstance(item, DeviceKey):
            self.devices.append(item)
        elif isinstance(item, WebhookEvent):
            self.events[item.event_id] = item

    async def get(self, model, key, **kwargs):
        if model is ActivationClaim:
            return self.claims.get(key)
        if model is WebhookEvent:
            return self.events.get(key)
        if model is Account:
            return self.accounts.get(key)
        return None

    async def execute(self, statement):
        entities = [description["entity"] for description in statement.column_descriptions]
        if entities == [ActivationClaim]:
            return FakeResult(next(iter(self.claims.values()), None))
        if entities == [DeviceKey, Account]:
            if not self.devices:
                return FakeResult(pair=None)
            device = self.devices[0]
            return FakeResult(pair=(device, self.accounts[device.account_id]))
        raise AssertionError(f"Unexpected query: {statement}")

    async def flush(self):
        for account in list(self.accounts.values()):
            if account.id is None:
                account.id = uuid.uuid4()
                self.accounts[account.id] = account
            if account.subscription_state is None:
                account.subscription_state = "active"
        for device in self.devices:
            if device.active is None:
                device.active = True

    async def commit(self):
        pass

    async def delete(self, item):
        self.claims.pop(item.reference_id, None)


def sandbox_settings():
    return Settings(
        _env_file=None,
        app_env="staging",
        public_origin="https://example.test",
        database_url="postgresql+asyncpg://localhost/dexplay",
        redis_url="redis://localhost:6379/0",
        openai_api_key="test-key",
        data_encryption_key=base64.urlsafe_b64encode(bytes(32)).decode(),
        api_key_pepper="paypal-flow-test-pepper-with-32-bytes",
        allowed_origins="https://example.test",
        paypal_mode="sandbox",
        paypal_sandbox_client_id="sandbox-client",
        paypal_sandbox_client_secret="sandbox-secret",
        paypal_sandbox_webhook_id="sandbox-webhook",
        paypal_sandbox_individual_plan_id="sandbox-individual",
        paypal_sandbox_clinic_plan_id="sandbox-clinic",
    )


class PayPalFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_sandbox_purchase_webhook_claim_and_key_activation(self):
        db = FakePaymentDB()
        client = SimpleNamespace(
            create_subscription=AsyncMock(
                return_value={
                    "id": "sandbox-subscription-123",
                    "status": "APPROVAL_PENDING",
                    "links": [{"rel": "approve", "href": "https://www.sandbox.paypal.com/checkout"}],
                }
            ),
            verify_webhook=AsyncMock(return_value=True),
        )
        with (
            patch.object(main, "settings", sandbox_settings()),
            patch.object(main, "PayPalClient", return_value=client),
        ):
            checkout = await main.create_subscription(
                SubscriptionRequest(plan="individual", language="en"),
                db,
            )
            claim = next(iter(db.claims.values()))
            event = {
                "id": "sandbox-event-1",
                "event_type": "BILLING.SUBSCRIPTION.ACTIVATED",
                "resource": {
                    "id": checkout["subscription_id"],
                    "custom_id": claim.reference_id,
                },
            }
            webhook_request = SimpleNamespace(json=AsyncMock(return_value=event), headers={})
            activated = await main.paypal_webhook(webhook_request, db)
            claimed = await main.claim_subscription(
                ClaimRequest(activation_token=checkout["activation_token"]),
                db,
            )
            key_result = await main.activate_device(
                KeyActivationRequest(api_key=claimed["keys"][0]["api_key"]),
                db,
            )

        self.assertEqual(checkout["status"], "APPROVAL_PENDING")
        self.assertIn("sandbox", checkout["approval_url"])
        client.create_subscription.assert_awaited_once()
        self.assertEqual(client.create_subscription.await_args.args[0], "sandbox-individual")
        client.verify_webhook.assert_awaited_once()
        self.assertEqual(activated, {"received": True})
        self.assertEqual(claimed["status"], "active")
        self.assertEqual(key_result["valid"], True)
        self.assertEqual(key_result["subscription_state"], "active")


if __name__ == "__main__":
    unittest.main()
