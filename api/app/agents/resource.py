from __future__ import annotations
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..models import CuratedResource, ResourceCandidate
from ..services.resource_discovery import age_range_matches
from .llm import call_tool

RESOURCE_TOOL = {"type":"object","properties":{
 "age_group":{"type":"string","maxLength":30},
 "language":{"type":"string","minLength":2,"maxLength":8},
 "types":{"type":"array","items":{"type":"string","enum":["video","pdf","guide"]}},
 "max_size_mb":{"type":"number","minimum":1,"maximum":50},"already_have":{"type":"array","items":{"type":"string"}}},
 "required":["age_group","language","types","max_size_mb","already_have"],"additionalProperties":False}

async def run(*, profile: dict, resource_preferences: dict, db: AsyncSession,
              current_session_context: dict) -> dict:
    requested_language = profile.get("language", "en")
    system = ("You select matching resources from DexPlay's reviewed catalog only. "
      f"Respect the user's requested language {requested_language} and broad age group. Never invent a resource or URL. "
      "Return search criteria by calling search_curated_resources.")
    def search(args):
        # DB-backed matching is completed asynchronously below; the LLM may narrow preferences,
        # but cannot create catalog entries.
        return args
    criteria = await call_tool(system=system, payload={"profile": profile,
        "preferences": resource_preferences, "session_context": current_session_context},
        tool_name="search_curated_resources", description="Select matching catalog search criteria.",
        parameters=RESOURCE_TOOL, handler=search)
    age = criteria["age_group"] or profile.get("age_group", "")
    language = criteria["language"] or requested_language
    max_mb = min(50.0, float(criteria["max_size_mb"]))
    already = set(criteria["already_have"])
    rows = (await db.execute(select(CuratedResource).where(CuratedResource.active.is_(True),
        CuratedResource.language == language))).scalars().all()
    def matches(row):
        return row.id not in already and (not criteria["types"] or row.resource_type in criteria["types"]) and \
            (not age or age.lower() in row.age_groups.lower())
    selected = [r for r in rows if matches(r)]
    fallback = False
    if not selected and language != "en":
        english_rows = (await db.execute(select(CuratedResource).where(CuratedResource.active.is_(True), CuratedResource.language == "en"))).scalars().all()
        selected = [r for r in english_rows if matches(r)]
        fallback = bool(selected)
    entries, size = [], 0
    for row in selected:
        if row.id in already:
            continue
        entries.append(({
            "id": row.id,
            "title": row.title,
            "type": row.resource_type,
            "url": row.source_url,
            "size_mb": round(row.size_bytes / 1024 / 1024, 2),
            "language": row.language,
            "sha256": row.sha256,
            "license": row.license_label,
            "externally_sourced": False,
            "clinic_recommended": row.clinic_approved,
            "clinic_approval_evidence": row.clinic_approval_evidence,
            "_size_bytes": row.size_bytes,
        }, row.clinic_approved, False))
    candidates = (await db.execute(
        select(ResourceCandidate)
        .where(
            ResourceCandidate.status == "published",
            ResourceCandidate.access_status == "free_public",
        )
        .order_by(ResourceCandidate.clinic_approved.desc(), ResourceCandidate.reviewed_at.desc())
    )).scalars().all()
    for candidate in candidates:
        if candidate.status != "published" or candidate.access_status != "free_public":
            continue
        if age and not age_range_matches(candidate.age_range, age):
            continue
        if candidate.source_url in already:
            continue
        entries.append(({
            "id": candidate.id,
            "title": candidate.title,
            "type": "guide",
            "url": candidate.source_url,
            "size_mb": 0,
            "language": "en",
            "sha256": None,
            "license": candidate.license_info,
            "externally_sourced": True,
            "clinic_recommended": candidate.clinic_approved,
            "clinic_approval_evidence": candidate.clinic_approval_evidence,
            "source": candidate.source_name,
            "discovered_at": candidate.discovered_at.isoformat(),
            "verified_at": candidate.verified_at.isoformat() if candidate.verified_at else None,
            "link_status": candidate.link_status,
            "access_status": candidate.access_status,
            "age_range": candidate.age_range,
            "mat_relevance": candidate.mat_relevance,
            "safety_notes": candidate.safety_notes,
            "review_notes": candidate.review_notes,
            "reviewer_role": candidate.reviewer_role,
            "reviewed_at": candidate.reviewed_at.isoformat() if candidate.reviewed_at else None,
            "_size_bytes": 0,
        }, candidate.clinic_approved, True))
    entries.sort(key=lambda entry: (not entry[1], entry[2]))
    items = []
    size = 0
    for item, _clinic_approved, _external in entries:
        item_size = item.pop("_size_bytes")
        if len(items) == 5 or size + item_size > max_mb * 1024 * 1024:
            continue
        size += item_size
        items.append(item)
        if item["externally_sourced"] and requested_language != "en":
            fallback = True
    return {"new_resources": items, "total_size_mb": round(size / 1024 / 1024, 2),
            "gaps": ([f"No reviewed resources currently match {age}/{requested_language}."] if not items else []),
            "language_fallback": fallback}
