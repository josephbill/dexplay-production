import base64
import os
import unittest
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError

os.environ["DATA_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(bytes(32)).decode()
os.environ["API_KEY_PEPPER"] = "free-analysis-test-pepper-with-32-bytes"
os.environ["OPENAI_API_KEY"] = "free-analysis-test-key"
os.environ["APP_ENV"] = "staging"

from app.agents import adaptive
from app.schemas import FreeAnalysisRequest


def valid_request() -> dict:
    return {
        "session_data": [
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
        "profile": {
            "group": "child",
            "age_group": "7-9",
            "language": "en",
            "difficulty": {"object_size_mm": 22},
            "recent_session_accuracy": [0.5, 0.75],
        },
    }


class FreeAnalysisSchemaTests(unittest.TestCase):
    def test_accepts_pseudonymous_performance_metrics(self) -> None:
        request = FreeAnalysisRequest.model_validate(valid_request())

        self.assertEqual(len(request.session_data), 1)
        self.assertEqual(request.profile.recent_session_accuracy, [0.5, 0.75])

    def test_rejects_personal_identifiers(self) -> None:
        values = valid_request()
        values["profile"]["name"] = "Example Patient"

        with self.assertRaises(ValidationError):
            FreeAnalysisRequest.model_validate(values)

    def test_rejects_invalid_accuracy(self) -> None:
        values = valid_request()
        values["session_data"][0]["accuracy"] = 1.5

        with self.assertRaises(ValidationError):
            FreeAnalysisRequest.model_validate(values)


class FreeAnalysisReportTests(unittest.IsolatedAsyncioTestCase):
    async def test_free_analysis_generates_only_a_brief_patient_report(self) -> None:
        request = FreeAnalysisRequest.model_validate(valid_request())

        async def fake_call_tool(**kwargs):
            return kwargs["handler"](
                {
                    "object_size_mm": 22,
                    "time_limit_s": 75,
                    "objects_count": 5,
                    "zone_size_mm": 80,
                    "speed_factor": 1.0,
                    "reason": "Maintain current difficulty.",
                    "flag": None,
                }
            )

        with (
            patch("app.agents.adaptive.call_tool", side_effect=fake_call_tool),
            patch(
                "app.agents.adaptive.generate_report",
                new_callable=AsyncMock,
                return_value={"report_text": "Good work.", "summary": "Three of four."},
            ) as generate_report,
        ):
            result = await adaptive.run(
                [item.model_dump() for item in request.session_data],
                request.profile.model_dump(),
                report_audiences=("patient",),
                brief_report=True,
            )

        self.assertEqual(set(result["report"]), {"patient"})
        self.assertEqual(generate_report.await_args.kwargs["context"], "brief")


if __name__ == "__main__":
    unittest.main()
