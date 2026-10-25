from __future__ import annotations
import asyncio
from .agents import adaptive, payment, resource
from .db import SessionLocal

def _fallback(profile: dict, session_data: list[dict]) -> dict:
    current = profile.get("difficulty", {})
    return {"next_difficulty": {"object_size_mm": current.get("object_size_mm", 22),
        "time_limit_s": None if profile.get("condition") == "parkinsons" else current.get("time_limit_s", 75),
        "objects_count": current.get("objects_count", 5), "zone_size_mm": current.get("zone_size_mm", 80),
        "speed_factor": current.get("speed_factor", 1), "rationale": "Cloud coaching is temporarily unavailable; keep the saved safe difficulty."},
        "report": {}, "flag": None,
        "improvement_trend": {"direction": "unavailable", "magnitude": 0, "confidence": 0}}

async def _run_one(name: str, awaitable, timeout: float = 9.8):
    try:
        return name, await asyncio.wait_for(awaitable, timeout=timeout), None
    except Exception as exc:
        return name, None, type(exc).__name__

async def orchestrate(*, session_data: list[dict], profile: dict, subscription_state: str,
                      usage_stats: dict, resource_preferences: dict, progress_summary: dict,
                      therapist_requested_reports: bool = False) -> dict:
    tasks = [
        asyncio.create_task(_run_one("adaptive", adaptive.run(session_data, profile))),
        asyncio.create_task(_run_one("payment", payment.run(usage_stats=usage_stats,
            progress_summary={**progress_summary, "session_data": session_data},
            subscription_state=subscription_state, profile=profile,
            therapist_requested_reports=therapist_requested_reports))),
        asyncio.create_task(_run_resource(profile, resource_preferences, {"session_data": session_data,
            "improvement_trend": usage_stats.get("improvement_trend", "unknown")})),
    ]
    done, pending = await asyncio.wait(tasks, timeout=10)
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    results = {"adaptive": None, "payment": None, "resource": None}
    unavailable = []
    for task in done:
        name, value, err = task.result()
        if err:
            unavailable.append(name)
        else:
            results[name] = value
    adaptive_result = results["adaptive"] or _fallback(profile, session_data)
    payment_result = results["payment"] or {"recommend": False, "message": "", "urgency": "low",
        "best_time": "weekly", "reason": "Payment agent unavailable", "paypal_action": "none"}
    resource_result = results["resource"] or {"new_resources": [], "total_size_mb": 0,
        "gaps": ["Resource service unavailable"], "language_fallback": False}
    return {"next_difficulty": adaptive_result["next_difficulty"],
        "report": adaptive_result.get("report", {}), "flag": adaptive_result.get("flag"),
        "improvement_trend": adaptive_result.get("improvement_trend"),
        "subscription_recommendation": payment_result, "paypal_action": payment_result.get("paypal_action", "none"),
        "new_resources": resource_result["new_resources"], "resource_total_mb": resource_result["total_size_mb"],
        "resource_gaps": resource_result["gaps"], "language_fallback": resource_result["language_fallback"],
        "partial": bool(unavailable), "agents_unavailable": unavailable}

async def _run_resource(profile, preferences, context):
    async with SessionLocal() as db:
        return await _run_one("resource", resource.run(profile=profile,
            resource_preferences=preferences, db=db, current_session_context=context))
