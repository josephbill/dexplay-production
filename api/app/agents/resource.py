from __future__ import annotations
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..models import CuratedResource
from .llm import call_tool

RESOURCE_TOOL = {"type":"object","properties":{
 "condition":{"type":"string","maxLength":80},"age_group":{"type":"string","maxLength":30},
 "language":{"type":"string","minLength":2,"maxLength":8},
 "types":{"type":"array","items":{"type":"string","enum":["video","pdf","guide"]}},
 "max_size_mb":{"type":"number","minimum":1,"maximum":50},"already_have":{"type":"array","items":{"type":"string"}}},
 "required":["condition","age_group","language","types","max_size_mb","already_have"],"additionalProperties":False}

async def run(*, profile: dict, resource_preferences: dict, db: AsyncSession,
              current_session_context: dict) -> dict:
    requested_language = profile.get("language", "en")
    system = ("You find only verified, published resources already present in DexPlay's curated database. "
      f"Respect the user's requested language {requested_language}, condition and age group. Never invent a resource or URL. "
      "Return search criteria by calling search_curated_resources.")
    def search(args):
        # DB-backed matching is completed asynchronously below; the LLM may narrow preferences,
        # but cannot create catalog entries.
        return args
    criteria = await call_tool(system=system, payload={"profile": profile,
        "preferences": resource_preferences, "session_context": current_session_context},
        tool_name="search_curated_resources", description="Select matching catalog search criteria.",
        parameters=RESOURCE_TOOL, handler=search)
    condition = criteria["condition"] or profile.get("condition", "")
    age = criteria["age_group"] or profile.get("age_group", "")
    language = criteria["language"] or requested_language
    max_mb = min(50.0, float(criteria["max_size_mb"]))
    already = set(criteria["already_have"])
    rows = (await db.execute(select(CuratedResource).where(CuratedResource.active.is_(True),
        CuratedResource.language == language))).scalars().all()
    def matches(row):
        return row.id not in already and (not criteria["types"] or row.resource_type in criteria["types"]) and \
            (not condition or condition.lower() in row.conditions.lower()) and \
            (not age or age.lower() in row.age_groups.lower())
    selected = [r for r in rows if matches(r)]
    fallback = False
    if not selected and language != "en":
        english_rows = (await db.execute(select(CuratedResource).where(CuratedResource.active.is_(True), CuratedResource.language == "en"))).scalars().all()
        selected = [r for r in english_rows if matches(r)]
        fallback = bool(selected)
    items, size = [], 0
    for row in selected:
        if len(items) == 5 or size + row.size_bytes > max_mb * 1024 * 1024:
            continue
        size += row.size_bytes
        items.append({"id": row.id, "title": row.title, "type": row.resource_type,
                      "url": row.source_url, "size_mb": round(row.size_bytes / 1024 / 1024, 2),
                      "language": row.language, "sha256": row.sha256,
                      "license": row.license_label})
    return {"new_resources": items, "total_size_mb": round(size / 1024 / 1024, 2),
            "gaps": ([f"No verified catalog resources currently match {condition}/{age}/{requested_language}."] if not items else []),
            "language_fallback": fallback}
