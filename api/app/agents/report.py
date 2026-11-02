from __future__ import annotations
from .llm import call_tool

REPORT_TOOL = {"type": "object", "properties": {
    "report_text": {"type": "string"}, "summary": {"type": "string"}},
    "required": ["report_text", "summary"], "additionalProperties": False}

async def generate_report(*, session_data: list[dict], profile: dict, audience: str,
                          period: str, language: str, context: str = "progress") -> dict:
    points = [r for r in session_data if isinstance(r, dict)]
    start = points[0] if points else {}
    end = points[-1] if points else {}
    facts = {"round_count": len(points), "start_accuracy": start.get("accuracy"),
             "end_accuracy": end.get("accuracy"), "start_time_sec": start.get("avg_time"),
             "end_time_sec": end.get("avg_time"), "profile": profile, "audience": audience,
             "period": period, "context": context}
    system = ("You write DexPlay progress reports for children, caregivers, and occupational therapists. "
              f"Write directly in {language}. Use culturally respectful wording and the audience's tone: "
              "parent warm and simple, therapist concise and clinical, patient encouraging. Never diagnose, "
              "invent measurements, guarantee recovery, or call a child a failure. For Parkinson's, emphasize "
              "stability and comfort, never speed. Return your report by calling the required tool.")
    if context == "brief":
        system += " Keep this free-user report to one or two short sentences: state the measured session result and add brief encouragement. Do not include treatment advice or recommendations."
    def deliver(args: dict) -> dict:
        if not args["report_text"].strip() or len(args["report_text"]) > 5000:
            raise ValueError("Report text is empty or too long")
        return {"report_text": args["report_text"].strip(), "summary": args["summary"].strip(),
                "audience": audience, "language": language}
    return await call_tool(system=system, payload=facts, tool_name="deliver_report",
        description="Deliver the completed report in the requested language. Use only provided session facts.",
        parameters=REPORT_TOOL, handler=deliver)
