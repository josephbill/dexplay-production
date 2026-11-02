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

from app.agents.llm import request_id_context
from app import orchestrator


class OrchestratorReportTests(unittest.IsolatedAsyncioTestCase):
    async def test_report_agent_failures_are_logged_with_request_correlation(self) -> None:
        async def fail_report():
            raise TimeoutError("provider timed out")

        with self.assertLogs("dexplay.orchestrator", level="ERROR") as captured:
            name, result, error = await orchestrator._run_one(
                "report_therapist",
                fail_report(),
                "sync-debug-test",
                timeout=1,
            )

        self.assertEqual((name, result, error), ("report_therapist", None, "TimeoutError"))
        self.assertTrue(any("request_id=sync-debug-test" in line and
                            "agent=report_therapist" in line and
                            "error_type=TimeoutError" in line
                            for line in captured.output))

    async def test_report_generation_runs_independently_of_adaptive_planning(self) -> None:
        observed_request_ids = []

        async def make_report(**kwargs):
            observed_request_ids.append(request_id_context.get())
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
                return_value={
                    "new_resources": [],
                    "total_size_mb": 0,
                    "gaps": [],
                    "language_fallback": False,
                },
            ),
        ):
            with self.assertLogs("dexplay.orchestrator", level="INFO") as captured:
                result = await orchestrator.orchestrate(
                    session_data=[{"round_num": 1, "accuracy": 0.75}],
                    profile={"language": "en", "difficulty": {"object_size_mm": 22}},
                    subscription_state="active",
                    usage_stats={},
                    resource_preferences={},
                    progress_summary={},
                    request_id="test-request-1234",
                )

        adaptive_run.assert_awaited_once()
        self.assertEqual(adaptive_run.await_args.kwargs["report_audiences"], ())
        self.assertEqual(report_run.await_count, 3)
        self.assertEqual(set(result["report"]), {"parent", "therapist", "patient"})
        self.assertFalse(result["partial"])
        self.assertEqual(observed_request_ids, ["test-request-1234"] * 3)
        self.assertTrue(any("agent.completed" in line and "agent=reports" in line
                            for line in captured.output))
        self.assertTrue(all("test-request-1234" in line for line in captured.output))
