from __future__ import annotations
from .llm import call_tool
from .report import generate_report

PAYMENT_TOOL = {"type":"object","properties":{
 "recommend":{"type":"boolean"},"reason":{"type":"string","maxLength":400},
 "urgency":{"type":"string","enum":["low","medium","high"]},
 "message":{"type":"string","maxLength":800},
 "best_time":{"type":"string","enum":["now","after_next_session","weekly"]}},
 "required":["recommend","reason","urgency","message","best_time"],"additionalProperties":False}

async def run(*, usage_stats: dict, progress_summary: dict, subscription_state: str,
              profile: dict, therapist_requested_reports: bool = False) -> dict:
    language = profile.get("language", "en")
    sessions = int(usage_stats.get("free_sessions_count", 0))
    days_lapsed = int(usage_stats.get("days_since_lapse", 0))
    plateau = bool(usage_stats.get("difficulty_plateau", False))
    trend = usage_stats.get("improvement_trend", "unknown")
    eligible = sessions >= 5
    system = ("You are a considerate subscription advisor. Return a recommendation using recommend_subscription. "
      f"Write the message in {language}. Never nag. Never recommend before five sessions, or while subscription is active. "
      "High urgency only when a therapist requested reports. A plateau matters only after 15 free sessions; improving "
      "users can be told about benefits gently after 30 sessions. A lapsed user can be welcomed back after seven days. "
      "Do not imply guaranteed clinical improvement.")
    payload = {"usage_stats": usage_stats, "progress_summary": progress_summary,
               "subscription_state": subscription_state, "has_therapist": profile.get("has_therapist", False),
               "therapist_requested_reports": therapist_requested_reports}
    def decide(args):
        allow = eligible and subscription_state != "active"
        wants_reports = allow and therapist_requested_reports
        plateau_offer = allow and plateau and sessions > 15
        improving_offer = allow and sessions > 30 and trend == "improving"
        lapse_offer = subscription_state == "lapsed" and days_lapsed > 7
        recommend = bool(wants_reports or plateau_offer or improving_offer or lapse_offer) and bool(args["recommend"])
        urgency = "high" if wants_reports else "medium" if plateau_offer or lapse_offer else "low" if improving_offer else "low"
        best_time = "now" if wants_reports or lapse_offer else "after_next_session" if plateau_offer else "weekly"
        return {"recommend": recommend, "reason": args["reason"] if recommend else "Continue free practice; recommendation threshold not met.",
                "urgency": urgency if recommend else "low", "message": args["message"] if recommend else "",
                "best_time": best_time, "paypal_action": "show_subscribe" if recommend else "none"}
    result = await call_tool(system=system, payload=payload, tool_name="recommend_subscription",
        description="Decide whether an upgrade is timely and write a gentle localized explanation.",
        parameters=PAYMENT_TOOL, handler=decide)
    if result["recommend"]:
        result["report_context"] = await generate_report(session_data=progress_summary.get("session_data", []),
            profile=profile, audience="therapist", period="session", language=language, context="subscription")
    return result
