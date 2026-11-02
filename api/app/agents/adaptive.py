from __future__ import annotations
from ..config import get_settings
from .llm import call_tool
from .report import generate_report

PLAN_TOOL = {"type":"object","properties":{
 "object_size_mm":{"type":"integer","minimum":12,"maximum":60},
 "time_limit_s":{"type":["integer","null"],"minimum":20,"maximum":600},
 "objects_count":{"type":"integer","minimum":1,"maximum":30},
 "zone_size_mm":{"type":"integer","minimum":20,"maximum":250},
 "speed_factor":{"type":"number","minimum":0.25,"maximum":2.0},
 "reason":{"type":"string","maxLength":300},
 "flag":{"type":["object","null"],"properties":{"severity":{"type":"string","enum":["low","medium","high"]},"note":{"type":"string","maxLength":500},"recommendation":{"type":"string","maxLength":500}},"required":["severity","note","recommendation"],"additionalProperties":False}
},"required":["object_size_mm","time_limit_s","objects_count","zone_size_mm","speed_factor","reason","flag"],"additionalProperties":False}

async def run(session_data: list[dict], profile: dict, *,
              report_audiences: tuple[str, ...] = ("parent", "therapist", "patient"),
              brief_report: bool = False) -> dict:
    language = profile.get("language", "en")
    is_child = profile.get("group", "child") == "child"
    latest_sessions = profile.get("recent_session_accuracy", [])[-3:]
    fallback_size = int(profile.get("difficulty", {}).get("object_size_mm", 22))
    therapist = profile.get("clinical_goals", [])
    system = ("You are DexPlay's dexterity coach. Return a difficulty plan by calling plan_dexterity_session. "
      f"Profile={profile.get('group','child')}, language={language}, age={profile.get('age_years','unspecified')}, "
      f"condition={profile.get('condition','unspecified')}, goals={therapist}. "
      "For children use simple, encouraging rationale; never say fail. Change difficulty only after accuracy >90% "
      "for 3 consecutive sessions or <50% for 3 sessions. Otherwise keep the current level. Never diagnose. "
      "Set time_limit_s null for Parkinson's or when profile requests no timer. Flag a concern only for evidence in supplied data.")
    def apply(args):
        accuracies = [float(a) for a in latest_sessions if isinstance(a, (int, float))]
        params = {k: args[k] for k in ("object_size_mm", "time_limit_s", "objects_count", "zone_size_mm", "speed_factor")}
        if profile.get("condition") == "parkinsons" or profile.get("no_timer"):
            params["time_limit_s"] = None
        # Validate child-profile constraints after model output.
        if is_child:
            params["object_size_mm"] = min(25, max(18, params["object_size_mm"]))
            params["time_limit_s"] = max(60, params["time_limit_s"] or 60)
        if len(accuracies) < 3 or not (all(v > .90 for v in accuracies[-3:]) or all(v < .50 for v in accuracies[-3:])):
            params["object_size_mm"] = min(25, max(18, fallback_size)) if is_child else fallback_size
            params["time_limit_s"] = None if profile.get("condition") == "parkinsons" else max(60, int(profile.get("difficulty", {}).get("time_limit_s", 75)))
            args["reason"] = "Keep the current difficulty until three consecutive sessions meet the profile threshold."
        return {"next_difficulty": {**params, "rationale": args["reason"]}, "flag": args["flag"],
                "improvement_trend": {"direction": "insufficient_data", "magnitude": 0, "confidence": 0.0}}
    result = await call_tool(system=system, payload={"session_data": session_data[-10:], "profile": profile,
             "recent_session_accuracy": latest_sessions}, tool_name="plan_dexterity_session",
             description="Choose validated next-session difficulty and any evidence-based safety concern.",
             parameters=PLAN_TOOL, handler=apply)
    if session_data and report_audiences:
        reports = await __import__("asyncio").gather(*[
            generate_report(session_data=session_data, profile=profile, audience=audience,
                            period="session", language=language,
                            context="brief" if brief_report else "progress")
            for audience in report_audiences
        ])
        result["report"] = dict(zip(report_audiences, reports))
    else:
        result["report"] = {audience: None for audience in report_audiences}
    return result
