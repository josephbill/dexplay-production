import unittest

from app.agents.privacy import (
    provider_profile,
    provider_resource_preferences,
    provider_rounds,
    provider_usage,
)


class ProviderPrivacyTests(unittest.TestCase):
    def test_round_metrics_exclude_identifiers_and_nested_untrusted_values(self) -> None:
        rows = provider_rounds(
            [
                {
                    "session_id": "session-secret",
                    "profile_id": "profile-secret",
                    "round_num": 1,
                    "mode": "sort_place",
                    "objects_placed": 3,
                    "objects_total": 4,
                    "avg_time": 12.5,
                    "fumbles": 1,
                    "accuracy": 0.75,
                    "report_text": "private text",
                    "unexpected": {"name": "private"},
                }
            ]
        )

        self.assertEqual(
            rows,
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

    def test_profile_keeps_only_broad_and_game_context(self) -> None:
        profile = provider_profile(
            {
                "name": "Fictional Child",
                "id": "profile-secret",
                "age_years": 8,
                "age_group": "7-9",
                "condition": "private condition",
                "hand": "left",
                "language": "en",
                "group": "child",
                "difficulty": {"object_size_mm": 22, "extra": "private"},
                "recent_session_accuracy": [0.5, 0.75],
            }
        )

        self.assertEqual(
            profile,
            {
                "group": "child",
                "age_group": "7-9",
                "language": "en",
                "recent_session_accuracy": [0.5, 0.75],
                "difficulty": {"object_size_mm": 22, "time_limit_s": None},
            },
        )

    def test_usage_and_preferences_do_not_forward_arbitrary_values(self) -> None:
        usage = provider_usage(
            {
                "free_sessions_count": "5",
                "improvement_trend": "improving",
                "name": "private",
                "report_text": "private",
            }
        )
        preferences = provider_resource_preferences(
            {
                "types": ["guide", {"private": "value"}],
                "already_have": ["profile-secret"],
                "max_size_mb": 10,
            }
        )

        self.assertEqual(usage["free_sessions_count"], 5)
        self.assertNotIn("name", usage)
        self.assertEqual(preferences, {"types": ["guide"], "max_size_mb": 10.0, "already_have": []})


if __name__ == "__main__":
    unittest.main()
