from __future__ import annotations

import math
import re
from typing import Any


DIFFICULTY_FIELDS = (
    "object_size_mm",
    "time_limit_s",
    "objects_count",
    "zone_size_mm",
    "speed_factor",
)

def bounded_int(value: Any, default: int, maximum: int) -> int:
    try:
        return max(0, min(maximum, int(value)))
    except (TypeError, ValueError, OverflowError):
        return default


def bounded_float(value: Any, default: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    if not parsed == parsed:
        return default
    return max(1.0, min(maximum, parsed))


def provider_rounds(session_data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    clean_rows = []
    for row in session_data[-10:]:
        if not isinstance(row, dict):
            continue
        clean: dict[str, Any] = {}
        round_num = row.get("round_num")
        if isinstance(round_num, int) and not isinstance(round_num, bool) and 1 <= round_num <= 100:
            clean["round_num"] = round_num
        mode = row.get("mode")
        if isinstance(mode, str) and mode in {"sort_place", "stack", "thread", "button"}:
            clean["mode"] = mode
        for field, upper in (("objects_placed", 100), ("objects_total", 100), ("fumbles", 1000)):
            value = row.get(field)
            if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= upper:
                clean[field] = value
        for field, lower, upper in (
            ("avg_time", 0, 3600),
            ("accuracy", 0, 1),
        ):
            value = row.get(field)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and lower <= value <= upper:
                clean[field] = value
        clean_rows.append(clean)
    return clean_rows


def provider_profile(profile: dict[str, Any]) -> dict[str, Any]:
    language = profile.get("language", "en")
    age_group = profile.get("age_group", "7-9")
    group = profile.get("group", "child")
    difficulty = profile.get("difficulty", {})
    return {
        "group": group if group in ("child", "clinic") else "child",
        "age_group": age_group if age_group in ("4-6", "7-9", "10-12") else "7-9",
        "language": language if isinstance(language, str) and re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,4})?", language) else "en",
        "recent_session_accuracy": [
            float(value)
            for value in profile.get("recent_session_accuracy", [])[-3:]
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 1
        ] if isinstance(profile.get("recent_session_accuracy", []), list) else [],
        "difficulty": {
            field: value
            for field in DIFFICULTY_FIELDS
            if isinstance(difficulty, dict)
            for value in [difficulty.get(field)]
            if (
                isinstance(value, int)
                and not isinstance(value, bool)
                and ((field == "object_size_mm" and 12 <= value <= 60)
                     or (field == "time_limit_s" and 20 <= value <= 600)
                     or (field == "objects_count" and 1 <= value <= 30)
                     or (field == "zone_size_mm" and 20 <= value <= 250))
            ) or (
                field == "speed_factor"
                and isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
                and 0.25 <= value <= 2
            ) or (
                field == "time_limit_s"
                and value is None
            )
        },
    }


def provider_usage(usage: dict[str, Any]) -> dict[str, Any]:
    allowed_trends = {"improving", "stable", "declining", "unknown"}
    trend = usage.get("improvement_trend", "unknown")
    return {
        "free_sessions_count": bounded_int(usage.get("free_sessions_count", 0), 0, 10000),
        "days_since_lapse": bounded_int(usage.get("days_since_lapse", 0), 0, 3650),
        "difficulty_plateau": bool(usage.get("difficulty_plateau", False)),
        "improvement_trend": trend if isinstance(trend, str) and trend in allowed_trends else "unknown",
        "therapist_requested_reports": bool(usage.get("therapist_requested_reports", False)),
    }


def provider_resource_preferences(preferences: dict[str, Any]) -> dict[str, Any]:
    allowed_types = {"video", "pdf", "guide"}
    types = preferences.get("types", [])
    return {
        "types": [item for item in types if isinstance(item, str) and item in allowed_types] if isinstance(types, list) else [],
        "max_size_mb": bounded_float(preferences.get("max_size_mb", 50), 50, 50),
        "already_have": [],
    }
