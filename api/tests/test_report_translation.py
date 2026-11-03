import base64
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.update(
    {
        "APP_ENV": "staging",
        "PUBLIC_ORIGIN": "https://example.test",
        "DATABASE_URL": "postgresql+asyncpg://localhost/dexplay",
        "REDIS_URL": "redis://localhost:6379/0",
        "OPENAI_API_KEY": "report-translation-test-key",
        "DATA_ENCRYPTION_KEY": base64.urlsafe_b64encode(bytes(32)).decode(),
        "API_KEY_PEPPER": "report-translation-test-pepper-with-32-bytes",
        "ALLOWED_ORIGINS": "https://example.test",
    }
)

from app.config import get_settings

get_settings.cache_clear()

from app import main
from app.schemas import ReportTranslationRequest


def request():
    return SimpleNamespace(state=SimpleNamespace(request_id="translation-test-request"))


def translation_body(**overrides):
    values = {
        "audience": "parent",
        "report_text": "The player completed three rounds.",
        "source_language": "en",
        "target_language": "es",
        "ai_consent": True,
    }
    values.update(overrides)
    return ReportTranslationRequest.model_validate(values)


class ReportTranslationTests(unittest.IsolatedAsyncioTestCase):
    async def test_translation_uses_only_report_content_and_language_context(self):
        body = translation_body()
        with patch(
            "app.main.translate_report_text",
            new_callable=AsyncMock,
            return_value="El jugador completó tres rondas.",
        ) as translate:
            result = await main.translate_report(
                request(),
                body,
                (SimpleNamespace(), SimpleNamespace()),
            )

        self.assertEqual(
            result,
            {"translated_text": "El jugador completó tres rondas.", "language": "es"},
        )
        self.assertEqual(
            translate.await_args.kwargs,
            {
                "report_text": "The player completed three rounds.",
                "audience": "parent",
                "source_language": "en",
                "target_language": "es",
            },
        )

    async def test_translation_failure_returns_service_unavailable(self):
        from fastapi import HTTPException

        with patch(
            "app.main.translate_report_text",
            new_callable=AsyncMock,
            side_effect=TimeoutError(),
        ):
            with self.assertRaises(HTTPException) as raised:
                await main.translate_report(
                    request(),
                    translation_body(),
                    (SimpleNamespace(), SimpleNamespace()),
                )

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(
            raised.exception.detail,
            "Report translation is temporarily unavailable.",
        )

    def test_translation_requires_explicit_ai_consent(self):
        from pydantic import ValidationError

        with self.assertRaises(ValidationError):
            translation_body(ai_consent=False)

    def test_translation_rejects_blank_report_text(self):
        from pydantic import ValidationError

        with self.assertRaises(ValidationError):
            translation_body(report_text="  ")


if __name__ == "__main__":
    unittest.main()
