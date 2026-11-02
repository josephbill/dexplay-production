import base64
import os
import unittest
from unittest.mock import AsyncMock, patch

os.environ["DATA_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(bytes(32)).decode()
os.environ["API_KEY_PEPPER"] = "orchestrator-test-pepper-with-32-bytes"
os.environ["OPENAI_API_KEY"] = "orchestrator-test-key"
os.environ["APP_ENV"] = "staging"
os.environ["PUBLIC_ORIGIN"] = "https://example.test"
os.environ["DATABASE_URL"] = "postgresql+asyncpg://test:test@localhost/dexplay"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"
os.environ["ALLOWED_ORIGINS"] = "https://example.test"

from app.config import get_settings

get_settings.cache_clear()

from app import orchestrator


class OrchestratorReportTests(unittest.IsolatedAsyncioTestCase):
    async def test_report_generation_runs_independently_of_adaptive_planning(self) -> None:
        async def make_report(**kwargs):
            return {
                "report_text": f"Report for {kwargs['audience']}",
                "summary": "Session summary",
            }

        with (
            patch(
                "app.orchestrator.adaptive.run",
                new_callable=AsyncMock,
                return_value={
                    "next_difficulty": {"object_size_mm": 22},
                    "report": {},
                },
            ) as adaptive_run,
            patch(
                "app.orchestrator.generate_report",
                new_callable=AsyncMock,
                side_effect=make_report,
            ) as report_run,
            patch(
                "app.orchestrator.payment.run",
                new_callable=AsyncMock,
                return_value={"recommend": False},
            ),
            patch(
                "app.orchestrator._run_resource",
                new_callable=AsyncMock,
                return_value=("resource", {
                    "new_resources": [],
                    "total_size_mb": 0,
                    "gaps": [],
                    "language_fallback": False,
                }, None),
            ),
        ):
            result = await orchestrator.orchestrate(
                session_data=[{"round_num": 1, "accuracy": 0.75}],
                profile={"language": "en", "difficulty": {"object_size_mm": 22}},
                subscription_state="active",
                usage_stats={},
                resource_preferences={},
                progress_summary={},
            )

        adaptive_run.assert_awaited_once()
        self.assertEqual(adaptive_run.await_args.kwargs["report_audiences"], ())
        self.assertEqual(report_run.await_count, 3)
        self.assertEqual(set(result["report"]), {"parent", "therapist", "patient"})
        self.assertFalse(result["partial"])
