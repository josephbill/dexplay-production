from __future__ import annotations
import asyncio, json, logging
from contextvars import ContextVar
from time import perf_counter
from typing import Any, Awaitable, Callable
from openai import AsyncOpenAI
from ..config import get_settings

log = logging.getLogger("dexplay.llm")
request_id_context: ContextVar[str] = ContextVar("dexplay_request_id", default="unknown")
_client = AsyncOpenAI(api_key=get_settings().openai_api_key, timeout=8.0, max_retries=1)

async def call_tool(*, system: str, payload: dict, tool_name: str, description: str,
                    parameters: dict, handler: Callable[[dict], Any | Awaitable[Any]],
                    model: str | None = None) -> dict:
    """Require a real function call, execute the domain handler, and return its result."""
    selected_model = model or get_settings().openai_model
    started = perf_counter()
    request_id = request_id_context.get()
    log.info("llm.request_started request_id=%s tool=%s model=%s",
             request_id, tool_name, selected_model)
    tool = {"type": "function", "function": {"name": tool_name, "description": description,
             "parameters": parameters, "strict": True}}
    try:
        response = await asyncio.wait_for(_client.chat.completions.create(
            model=selected_model,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": json.dumps(payload, ensure_ascii=False, separators=(",", ":"))}],
            tools=[tool], tool_choice={"type": "function", "function": {"name": tool_name}},
            parallel_tool_calls=False, temperature=0.2), timeout=9.0)
    except Exception as exc:
        log.error("llm.request_failed request_id=%s tool=%s model=%s error_type=%s status_code=%s "
                  "error_code=%s provider_request_id=%s elapsed_ms=%s",
                  request_id, tool_name, selected_model, type(exc).__name__,
                  getattr(exc, "status_code", None), getattr(exc, "code", None),
                  getattr(exc, "request_id", None),
                  round((perf_counter() - started) * 1000))
        raise

    choices = getattr(response, "choices", None) or []
    calls = choices[0].message.tool_calls if choices and choices[0].message else None
    calls = calls or []
    if not calls or calls[0].function.name != tool_name:
        log.error("llm.required_tool_missing request_id=%s tool=%s model=%s choices=%s "
                  "finish_reason=%s provider_request_id=%s",
                  request_id, tool_name, selected_model, len(choices),
                  choices[0].finish_reason if choices else None,
                  getattr(response, "_request_id", None))
        raise RuntimeError(f"LLM did not call required tool {tool_name}")
    try:
        arguments = json.loads(calls[0].function.arguments)
        result = handler(arguments)
        if hasattr(result, "__await__"):
            result = await result
        if not isinstance(result, dict):
            raise TypeError(f"Tool {tool_name} must return an object")
    except Exception as exc:
        log.error("llm.tool_handler_failed request_id=%s tool=%s model=%s error_type=%s "
                  "provider_request_id=%s elapsed_ms=%s",
                  request_id, tool_name, selected_model, type(exc).__name__,
                  getattr(response, "_request_id", None),
                  round((perf_counter() - started) * 1000))
        raise

    usage = getattr(response, "usage", None)
    log.info("llm.request_completed request_id=%s tool=%s model=%s provider_request_id=%s "
             "prompt_tokens=%s completion_tokens=%s elapsed_ms=%s",
             request_id, tool_name, selected_model, getattr(response, "_request_id", None),
             getattr(usage, "prompt_tokens", None), getattr(usage, "completion_tokens", None),
             round((perf_counter() - started) * 1000))
    return result
