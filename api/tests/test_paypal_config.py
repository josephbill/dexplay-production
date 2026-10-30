import base64
import unittest

from pydantic import ValidationError

from app.config import Settings


def settings(**overrides: str) -> Settings:
    values = {
        "app_env": "staging",
        "public_origin": "https://dexplay-web-sandbox.onrender.com",
        "database_url": "postgresql+asyncpg://localhost/dexplay",
        "redis_url": "redis://localhost:6379/0",
        "openai_api_key": "test-key",
        "data_encryption_key": base64.urlsafe_b64encode(bytes(32)).decode(),
        "api_key_pepper": "test-pepper-with-at-least-32-bytes",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


class PayPalConfigTests(unittest.TestCase):
    def test_sandbox_mode_selects_only_sandbox_credentials_and_plans(self) -> None:
        config = settings(
            paypal_mode="sandbox",
            paypal_client_id="live-client",
            paypal_client_secret="live-secret",
            paypal_webhook_id="live-webhook",
            paypal_individual_plan_id="live-individual",
            paypal_clinic_plan_id="live-clinic",
            paypal_sandbox_client_id="sandbox-client",
            paypal_sandbox_client_secret="sandbox-secret",
            paypal_sandbox_webhook_id="sandbox-webhook",
            paypal_sandbox_individual_plan_id="sandbox-individual",
            paypal_sandbox_clinic_plan_id="sandbox-clinic",
        )

        self.assertEqual(config.paypal_api_base, "https://api-m.sandbox.paypal.com")
        self.assertEqual(config.active_paypal_client_id, "sandbox-client")
        self.assertEqual(config.active_paypal_client_secret, "sandbox-secret")
        self.assertEqual(config.active_paypal_webhook_id, "sandbox-webhook")
        self.assertEqual(config.active_paypal_individual_plan_id, "sandbox-individual")
        self.assertEqual(config.active_paypal_clinic_plan_id, "sandbox-clinic")
        self.assertTrue(config.paypal_enabled)

    def test_live_mode_selects_live_credentials_and_endpoint(self) -> None:
        config = settings(
            app_env="production",
            paypal_client_id="live-client",
            paypal_client_secret="live-secret",
            paypal_webhook_id="live-webhook",
            paypal_individual_plan_id="live-individual",
            paypal_clinic_plan_id="live-clinic",
            paypal_sandbox_client_id="sandbox-client",
        )

        self.assertEqual(config.paypal_api_base, "https://api-m.paypal.com")
        self.assertEqual(config.active_paypal_client_id, "live-client")
        self.assertTrue(config.paypal_enabled)

    def test_production_rejects_sandbox_mode(self) -> None:
        with self.assertRaises(ValidationError):
            settings(app_env="production", paypal_mode="sandbox")

    def test_production_guard_is_case_and_whitespace_insensitive(self) -> None:
        with self.assertRaises(ValidationError):
            settings(app_env=" Production ", paypal_mode="sandbox")

    def test_unknown_paypal_mode_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            settings(paypal_mode="demo")


if __name__ == "__main__":
    unittest.main()
