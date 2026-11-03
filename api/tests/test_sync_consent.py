import base64
import os
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from starlette.requests import Request
from starlette.responses import Response

os.environ.update(
    {
        "APP_ENV": "staging",
        "PUBLIC_ORIGIN": "https://example.test",
        "DATABASE_URL": "postgresql+asyncpg://localhost/dexplay",
        "REDIS_URL": "redis://localhost:6379/0",
        "OPENAI_API_KEY": "sync-consent-test-key",
        "DATA_ENCRYPTION_KEY": base64.urlsafe_b64encode(bytes(32)).decode(),
        "API_KEY_PEPPER": "sync-consent-test-pepper-with-32-bytes",
        "ALLOWED_ORIGINS": "https://example.test",
    }
)

from app.config import get_settings

get_settings.cache_clear()

from app import main
from app.schemas import SyncRequest


class FakeResult:
    def scalar(self):
        return 2


class FakeDB:
    def __init__(self):
        self.added = []

    async def get(self, model, key, **kwargs):
        return None

    async def execute(self, statement):
        return FakeResult()

    async def scalar(self, statement):
        return 2

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        pass


def request():
    return SimpleNamespace(state=SimpleNamespace(request_id="consent-test-request"))


def body(ai_consent: bool) -> SyncRequest:
    return SyncRequest.model_validate(
        {
            "session_data": [
                {
                    "session_id": "session-private",
                    "round_num": 1,
                    "mode": "sort_place",
                    "objects_placed": 3,
                    "objects_total": 4,
                    "avg_time": 12.5,
                    "fumbles": 1,
                    "accuracy": 0.75,
                    "report_text": "private report",
                }
            ],
            "profile": {
                "id": "profile-private",
                "name": "Fictional Child",
                "age_years": 8,
                "age_group": "7-9",
                "condition": "private condition",
                "hand": "left",
                "group": "child",
                "language": "en",
                "difficulty": {"object_size_mm": 22},
            },
            "usage_stats": {
                "free_sessions_count": 3,
                "name": "private",
                "report_text": "private",
            },
            "resource_preferences": {
                "types": ["guide"],
                "max_size_mb": 10,
                "already_have": ["private-id"],
            },
            "ai_consent": ai_consent,
        }
    )


class SyncConsentTests(unittest.IsolatedAsyncioTestCase):
    async def test_http_operation_logs_use_route_templates_not_path_identifiers(self):
        private_resource_id = "resource-candidate-private-id"
        request = Request(
            {
                "type": "http",
                "asgi": {"version": "3.0", "spec_version": "2.3"},
                "http_version": "1.1",
                "method": "POST",
                "scheme": "https",
                "path": f"/review/resources/candidates/{private_resource_id}/approve",
                "raw_path": f"/review/resources/candidates/{private_resource_id}/approve".encode(),
                "query_string": b"",
                "headers": [(b"x-request-id", b"12345678-1234-1234-1234-123456789abc")],
                "server": ("example.test", 443),
                "client": ("127.0.0.1", 12345),
            }
        )
        request.scope["route"] = SimpleNamespace(
            path="/review/resources/candidates/{candidate_id}/approve"
        )

        async def call_next(_request):
            return Response(status_code=200)

        with self.assertLogs("dexplay.api", level="INFO") as captured:
            response = await main.security_headers(request, call_next)

        joined_logs = "\n".join(captured.output)
        self.assertIn("route=/review/resources/candidates/{candidate_id}/approve", joined_logs)
        self.assertNotIn(private_resource_id, joined_logs)
        self.assertEqual(response.headers["X-Request-ID"], "12345678-1234-1234-1234-123456789abc")

    async def test_sync_never_calls_agents_when_consent_is_off(self):
        with patch("app.main.orchestrate", new_callable=AsyncMock) as orchestrate:
            result = await main.sync(
                request(),
                body(False),
                (SimpleNamespace(), SimpleNamespace(id=uuid.uuid4(), subscription_state="active")),
                FakeDB(),
            )

        orchestrate.assert_not_awaited()
        self.assertFalse(result["ai_generated"])
        self.assertIn("consent is off", result["analysis_status"])

    async def test_consented_sync_sends_only_minimized_provider_context(self):
        agent_result = {
            "report": {},
            "next_difficulty": {"object_size_mm": 22},
            "partial": False,
            "agents_unavailable": [],
        }
        with patch("app.main.orchestrate", new_callable=AsyncMock, return_value=agent_result) as orchestrate:
            result = await main.sync(
                request(),
                body(True),
                (SimpleNamespace(), SimpleNamespace(id=uuid.uuid4(), subscription_state="active")),
                FakeDB(),
            )

        kwargs = orchestrate.await_args.kwargs
        self.assertEqual(
            kwargs["session_data"],
            [
                {
                    "round_num": 1,
                    "mode": "sort_place",
                    "objects_placed": 3,
                    "objects_total": 4,
                    "avg_time": 12.5,
                    "fumbles": 1,
                    "accuracy": 0.75,
                }
            ],
        )
        self.assertEqual(
            set(kwargs["profile"]),
            {"group", "age_group", "language", "recent_session_accuracy", "difficulty"},
        )
        self.assertEqual(kwargs["resource_preferences"]["already_have"], [])
        self.assertNotIn("name", kwargs["profile"])
        self.assertNotIn("condition", kwargs["profile"])
        self.assertNotIn("session_id", str(kwargs))
        self.assertTrue(result["ai_generated"])


if __name__ == "__main__":
    unittest.main()
