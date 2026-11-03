import base64
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import HTTPException

os.environ.update(
    {
        "APP_ENV": "staging",
        "PUBLIC_ORIGIN": "https://example.test",
        "DATABASE_URL": "postgresql+asyncpg://localhost/dexplay",
        "REDIS_URL": "redis://localhost:6379/0",
        "OPENAI_API_KEY": "resource-review-test-key",
        "DATA_ENCRYPTION_KEY": base64.urlsafe_b64encode(bytes(32)).decode(),
        "API_KEY_PEPPER": "resource-review-test-pepper-with-32-bytes",
        "ALLOWED_ORIGINS": "https://example.test",
    }
)

from app.config import get_settings

get_settings.cache_clear()

from app import main
from app.agents import resource
from app.models import CuratedResource, ResourceCandidate
from app.schemas import CandidateReviewRequest
from app.services.resource_discovery import age_range_matches, allowed_public_url, parse_ot_toolbox_feed


class ResourceDiscoveryTests(unittest.TestCase):
    def test_feed_parser_keeps_only_relevant_allowlisted_source_links(self):
        feed = b"""<?xml version="1.0"?>
        <rss version="2.0"><channel>
          <item><title>Fine Motor Game Ideas</title>
            <link>https://www.theottoolbox.com/fine-motor/</link>
            <description>Fine motor activities.</description>
          </item>
          <item><title>General News</title>
            <link>https://www.theottoolbox.com/news/</link>
            <description>Unrelated article.</description>
          </item>
          <item><title>Hand-eye game</title>
            <link>https://example.org/article</link>
            <description>Not allowlisted.</description>
          </item>
        </channel></rss>"""

        candidates = parse_ot_toolbox_feed(feed)

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["publisher"], "The OT Toolbox")
        self.assertTrue(allowed_public_url("https://physio-pedia.com/article"))
        self.assertFalse(allowed_public_url("https://subdomain.theottoolbox.com/article"))
        self.assertFalse(allowed_public_url("https://theottoolbox.com.evil.example/article"))
        self.assertFalse(allowed_public_url("https://www.theottoolbox.com:99999/article"))
        self.assertTrue(age_range_matches("Ages 4–12 years", "7-9"))
        self.assertFalse(age_range_matches("Ages 4-6", "7-9"))


class FakeReviewDB:
    def __init__(self, candidate):
        self.candidate = candidate

    async def get(self, model, key, **kwargs):
        return self.candidate

    async def commit(self):
        pass


def candidate(link_status="HTTP 200"):
    return ResourceCandidate(
        id="candidate-id",
        title="Color matching play",
        source_name="The OT Toolbox",
        source_url="https://www.theottoolbox.com/color-play/",
        discovered_at=datetime.now(timezone.utc),
        verified_at=datetime.now(timezone.utc),
        link_status=link_status,
        access_status="not reviewed",
        license_info="not reviewed",
        age_range="not reviewed",
        mat_relevance="not reviewed",
        safety_notes="not reviewed",
        review_notes="",
        status="candidate",
        clinic_approved=False,
    )


class ResourceReviewApprovalTests(unittest.IsolatedAsyncioTestCase):
    async def test_public_catalog_prioritizes_global_clinic_approvals(self):
        curated = CuratedResource(
            id="curated-approved",
            title="Clinic-approved catalog activity",
            source_url="https://example.test/curated",
            language="en",
            resource_type="guide",
            age_groups="7-9",
            size_bytes=0,
            sha256="a" * 64,
            license_label="Public",
            active=True,
            clinic_approved=True,
            clinic_approval_evidence="Approved globally by the clinic.",
        )
        approved_web = candidate()
        approved_web.id = "web-approved"
        approved_web.title = "Clinic-approved external activity"
        approved_web.status = "published"
        approved_web.access_status = "free_public"
        approved_web.age_range = "7-9"
        approved_web.clinic_approved = True
        approved_web.clinic_approval_evidence = "Approved globally by the clinic."
        public_web = candidate()
        public_web.id = "web-public"
        public_web.status = "published"
        public_web.access_status = "free_public"
        public_web.age_range = "7-9"

        class FakeCatalogResult:
            def __init__(self, rows):
                self.rows = rows

            def scalars(self):
                return self

            def all(self):
                return self.rows

        class FakeCatalogDB:
            async def execute(self, statement):
                entity = statement.column_descriptions[0]["entity"]
                rows = {
                    CuratedResource: [curated],
                    ResourceCandidate: [public_web, approved_web],
                }
                return FakeCatalogResult(rows.get(entity, []))

        result = await main.public_resources("7-9", "en", FakeCatalogDB())
        resources = result["resources"]

        self.assertEqual(
            [item["id"] for item in resources],
            ["curated-approved", "web-approved", "web-public"],
        )
        self.assertTrue(resources[0]["clinic_recommended"])
        self.assertTrue(resources[1]["externally_sourced"])
        self.assertFalse(resources[2]["clinic_recommended"])

    async def test_public_catalog_excludes_pending_and_unreviewed_candidates(self):
        published = candidate()
        published.status = "published"
        published.access_status = "free_public"
        published.age_range = "Ages 4-12"
        pending = candidate()
        pending.id = "pending"

        class FakeCatalogResult:
            def __init__(self, rows):
                self.rows = rows

            def scalars(self):
                return self

            def all(self):
                return self.rows

        class FakeCatalogDB:
            async def execute(self, statement):
                entity = statement.column_descriptions[0]["entity"]
                return FakeCatalogResult([published, pending] if entity is ResourceCandidate else [])

        result = await main.public_resources("7-9", "en", FakeCatalogDB())

        self.assertEqual([item["id"] for item in result["resources"]], ["candidate-id"])

    async def test_resource_agent_returns_only_published_age_matches_in_approval_order(self):
        clinic_approved = candidate()
        clinic_approved.id = "clinic-approved"
        clinic_approved.title = "Approved activity"
        clinic_approved.status = "published"
        clinic_approved.access_status = "free_public"
        clinic_approved.age_range = "Ages 4–12"
        clinic_approved.clinic_approved = True
        clinic_approved.reviewed_at = datetime.now(timezone.utc)
        external = candidate()
        external.id = "external"
        external.title = "Published external"
        external.status = "published"
        external.access_status = "free_public"
        external.age_range = "7-9"
        external.reviewed_at = datetime.now(timezone.utc)
        pending = candidate()
        pending.status = "candidate"
        pending.access_status = "not reviewed"

        class FakeCatalogResult:
            def __init__(self, rows):
                self.rows = rows

            def scalars(self):
                return self

            def all(self):
                return self.rows

        class FakeCatalogDB:
            async def execute(self, statement):
                entity = statement.column_descriptions[0]["entity"]
                if entity is ResourceCandidate:
                    return FakeCatalogResult([clinic_approved, external, pending])
                return FakeCatalogResult([])

        async def fake_tool(**kwargs):
            return kwargs["handler"](
                {
                    "age_group": "7-9",
                    "language": "en",
                    "types": ["guide"],
                    "max_size_mb": 10,
                    "already_have": [],
                }
            )

        with patch("app.agents.resource.call_tool", side_effect=fake_tool):
            result = await resource.run(
                profile={"language": "en", "age_group": "7-9"},
                resource_preferences={},
                db=FakeCatalogDB(),
                current_session_context={"mode": "sort_place"},
            )

        self.assertEqual(
            [item["id"] for item in result["new_resources"]],
            ["clinic-approved", "external"],
        )
        self.assertTrue(result["new_resources"][0]["clinic_recommended"])
        self.assertFalse(result["new_resources"][1]["clinic_recommended"])

    async def test_reviewer_endpoints_require_configured_bearer_credential(self):
        with patch.object(main.settings, "resource_reviewer_token", "reviewer-secret"):
            await main.authenticated_resource_reviewer("Bearer reviewer-secret")
            with self.assertRaises(HTTPException) as raised:
                await main.authenticated_resource_reviewer("Bearer wrong")

        self.assertEqual(raised.exception.status_code, 401)

    async def test_unconfigured_reviewer_workflow_fails_closed(self):
        with patch.object(main.settings, "resource_reviewer_token", ""):
            with self.assertRaises(HTTPException) as raised:
                await main.authenticated_resource_reviewer("Bearer anything")

        self.assertEqual(raised.exception.status_code, 503)

    async def test_only_free_public_resources_can_be_published(self):
        body = CandidateReviewRequest(
            access_status="paid",
            license_info="Unknown",
            age_range="7-9",
            mat_relevance="Color sorting",
            safety_notes="Reviewer checked for safety.",
        )
        with self.assertRaises(HTTPException) as raised:
            await main.approve_resource_candidate(
                "candidate-id", body, None, FakeReviewDB(candidate())
            )

        self.assertEqual(raised.exception.status_code, 422)

    async def test_inconclusive_link_check_requires_reviewer_notes(self):
        body = CandidateReviewRequest(
            access_status="free_public",
            license_info="Unknown",
            age_range="7-9",
            mat_relevance="Color sorting",
            safety_notes="Reviewer checked for safety.",
        )
        with self.assertRaises(HTTPException) as raised:
            await main.approve_resource_candidate(
                "candidate-id", body, None, FakeReviewDB(candidate("HTTP 405"))
            )

        self.assertEqual(raised.exception.status_code, 422)

    async def test_manual_link_verification_records_a_verification_date(self):
        reviewed = candidate(link_status="HTTP 405")
        previous_check = reviewed.verified_at
        body = CandidateReviewRequest(
            access_status="free_public",
            license_info="Unknown",
            age_range="7-9",
            mat_relevance="Color sorting",
            safety_notes="Reviewer checked the linked activity for child safety.",
            review_notes="Opened the page and confirmed it resolves to the reviewed activity.",
            link_verified=True,
        )

        result = await main.approve_resource_candidate(
            "candidate-id", body, None, FakeReviewDB(reviewed)
        )

        self.assertIn("manual verification", result["resource"]["link_status"])
        self.assertIn("HTTP 405", result["resource"]["link_status"])
        self.assertGreaterEqual(reviewed.verified_at, previous_check)

    async def test_global_clinic_approval_requires_evidence(self):
        body = CandidateReviewRequest(
            access_status="free_public",
            license_info="Unknown",
            age_range="7-9",
            mat_relevance="Color sorting",
            safety_notes="Reviewer checked for safety.",
            clinic_approved=True,
        )
        with self.assertRaises(HTTPException) as raised:
            await main.approve_resource_candidate(
                "candidate-id", body, None, FakeReviewDB(candidate())
            )

        self.assertEqual(raised.exception.status_code, 422)

    async def test_human_approval_publishes_with_review_metadata(self):
        item = candidate()
        body = CandidateReviewRequest(
            access_status="free_public",
            license_info="Copyright status unknown.",
            age_range="7-9",
            mat_relevance="A reviewer mapped the activity to color sorting on the mat.",
            safety_notes="Adult supervision recommended.",
            review_notes="Verified public page manually.",
            clinic_approved=True,
            clinic_approval_evidence="Approved by the PoC clinic reviewer.",
        )

        result = await main.approve_resource_candidate(
            "candidate-id", body, None, FakeReviewDB(item)
        )

        self.assertEqual(item.status, "published")
        self.assertEqual(item.access_status, "free_public")
        self.assertEqual(item.reviewer_role, "Designated DexPlay content reviewer")
        self.assertEqual(result["resource"]["clinic_approval_evidence"], "Approved by the PoC clinic reviewer.")


if __name__ == "__main__":
    unittest.main()
