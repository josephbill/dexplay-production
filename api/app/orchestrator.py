from __future__ import annotations
import asyncio, logging
from time import perf_counter
from .agents import adaptive, payment, resource
from .agents.llm import request_id_context
from .agents.report import generate_report
from .db import SessionLocal

log = logging.getLogger("dexplay.orchestrator")

def _fallback(profile: dict, session_data: list[dict]) -> dict:
    current = profile.get("difficulty", {})
    return {"next_difficulty": {"object_size_mm": current.get("object_size_mm", 22),
        "time_limit_s": current.get("time_limit_s", 75),
        "objects_count": current.get("objects_count", 5), "zone_size_mm": current.get("zone_size_mm", 80),
        "speed_factor": current.get("speed_factor", 1), "rationale": "Cloud coaching is temporarily unavailable; keep the saved safe difficulty."},
        "report": {}, "flag": None,
        "improvement_trend": {"direction": "unavailable", "magnitude": 0, "confidence": 0}}

async def _run_one(name: str, awaitable, request_id: str, timeout: float = 9.8):
    context_token = request_id_context.set(request_id)
    started = perf_counter()
    log.info("agent.started request_id=%s agent=%s timeout_s=%.1f", request_id, name, timeout)
    try:
        try:
            result = await asyncio.wait_for(awaitable, timeout=timeout)
        except Exception as exc:
            elapsed_ms = round((perf_counter() - started) * 1000)
            log.error("agent.failed request_id=%s agent=%s error_type=%s elapsed_ms=%s",
                      request_id, name, type(exc).__name__, elapsed_ms)
            return name, None, type(exc).__name__
        except asyncio.CancelledError:
            log.warning("agent.cancelled request_id=%s agent=%s elapsed_ms=%s",
                        request_id, name, round((perf_counter() - started) * 1000))
            raise
        elapsed_ms = round((perf_counter() - started) * 1000)
        log.info("agent.completed request_id=%s agent=%s elapsed_ms=%s",
                 request_id, name, elapsed_ms)
        return name, result, None
    finally:
        request_id_context.reset(context_token)

async def orchestrate(*, session_data: list[dict], profile: dict, subscription_state: str,
                      usage_stats: dict, resource_preferences: dict, progress_summary: dict,
                      therapist_requested_reports: bool = False, request_id: str = "unknown") -> dict:
    orchestration_started = perf_counter()
    log.info("orchestration.started request_id=%s rounds=%s", request_id, len(session_data))
    tasks = {
        "adaptive": asyncio.create_task(_run_one("adaptive", adaptive.run(session_data, profile, report_audiences=()), request_id)),
        "reports": asyncio.create_task(_run_one("reports", _run_reports(session_data, profile, request_id), request_id)),
        "payment": asyncio.create_task(_run_one("payment", payment.run(usage_stats=usage_stats,
            progress_summary={**progress_summary, "session_data": session_data},
            subscription_state=subscription_state, profile=profile,
            therapist_requested_reports=therapist_requested_reports), request_id)),
        "resource": asyncio.create_task(_run_one("resource", _run_resource(
            profile, resource_preferences, {"mode": session_data[-1].get("mode", "sort_place") if session_data else "sort_place"}
        ), request_id)),
    }
    done, pending = await asyncio.wait(tasks.values(), timeout=10)
    unavailable = []
    for task in pending:
        name = next(name for name, candidate in tasks.items() if candidate is task)
        unavailable.append(name)
        log.error("agent.deadline_exceeded request_id=%s agent=%s orchestration_timeout_s=10",
                  request_id, name)
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    results = {"adaptive": None, "reports": None, "payment": None, "resource": None}
    for task in done:
        name = next(name for name, candidate in tasks.items() if candidate is task)
        if task.cancelled():
            if name not in unavailable:
                unavailable.append(name)
            continue
        try:
            result_name, value, err = task.result()
        except Exception as exc:
            log.error("agent.wrapper_failed request_id=%s agent=%s error_type=%s",
                      request_id, name, type(exc).__name__)
            unavailable.append(name)
            continue
        if result_name != name:
            log.error("agent.result_name_mismatch request_id=%s task=%s result=%s",
                      request_id, name, result_name)
            unavailable.append(name)
            continue
        if err:
            unavailable.append(name)
        else:
            results[name] = value
    adaptive_result = results["adaptive"] or _fallback(profile, session_data)
    if results["reports"]:
        reports, report_errors = results["reports"]
        unavailable.extend(report_errors)
    else:
        reports = {}
    payment_result = results["payment"] or {"recommend": False, "message": "", "urgency": "low",
        "best_time": "weekly", "reason": "Payment agent unavailable", "paypal_action": "none"}
    resource_result = results["resource"] or {"new_resources": [], "total_size_mb": 0,
        "gaps": ["Resource service unavailable"], "language_fallback": False}
    result = {"next_difficulty": adaptive_result["next_difficulty"],
        "report": reports, "flag": adaptive_result.get("flag"),
        "improvement_trend": adaptive_result.get("improvement_trend"),
        "subscription_recommendation": payment_result, "paypal_action": payment_result.get("paypal_action", "none"),
        "new_resources": resource_result["new_resources"], "resource_total_mb": resource_result["total_size_mb"],
        "resource_gaps": resource_result["gaps"], "language_fallback": resource_result["language_fallback"],
        "partial": bool(unavailable), "agents_unavailable": unavailable}
    log.info("orchestration.completed request_id=%s report_audiences=%s partial=%s "
             "agents_unavailable=%s elapsed_ms=%s",
             request_id, ",".join(reports) or "none", result["partial"],
             ",".join(unavailable) or "none",
             round((perf_counter() - orchestration_started) * 1000))
    return result

async def _run_resource(profile, preferences, context):
    async with SessionLocal() as db:
        return await resource.run(profile=profile,
            resource_preferences=preferences, db=db, current_session_context=context)

async def _run_reports(session_data: list[dict], profile: dict, request_id: str):
    language = profile.get("language", "en")
    audiences = ("parent", "therapist", "patient")
    results = await asyncio.gather(*[
        _run_one(f"report_{audience}", generate_report(
            session_data=session_data,
            profile=profile,
            audience=audience,
            period="session",
            language=language,
        ), request_id)
        for audience in audiences
    ])
    reports = {}
    unavailable = []
    for name, value, error in results:
        if error:
            unavailable.append(name)
        else:
            reports[name.removeprefix("report_")] = value
    return reports, unavailable
