from __future__ import annotations

from .llm import call_tool

TRANSLATION_TOOL = {
    "type": "object",
    "properties": {"translated_text": {"type": "string"}},
    "required": ["translated_text"],
    "additionalProperties": False,
}


async def translate_report_text(
    *,
    report_text: str,
    audience: str,
    source_language: str,
    target_language: str,
) -> str:
    system = (
        f"Translate the supplied DexPlay {audience} progress report from "
        f"{source_language} to {target_language}. Preserve its meaning, tone, "
        "caveats, and factual claims. Do not add, remove, summarize, or infer "
        "information. Return only the translation using the required tool."
    )

    def deliver(args: dict) -> dict:
        translated_text = args["translated_text"].strip()
        if not translated_text or len(translated_text) > 5000:
            raise ValueError("Translated report is empty or too long")
        return {"translated_text": translated_text}

    result = await call_tool(
        system=system,
        payload={"audience": audience, "report_text": report_text},
        tool_name="deliver_translation",
        description="Return a faithful translation of the provided report text.",
        parameters=TRANSLATION_TOOL,
        handler=deliver,
    )
    return result["translated_text"]
