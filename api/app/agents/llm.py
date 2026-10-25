from __future__ import annotations
import asyncio, json
from typing import Any, Awaitable, Callable
from openai import AsyncOpenAI
from ..config import get_settings

_client = AsyncOpenAI(api_key=get_settings().openai_api_key, timeout=8.0, max_retries=1)

async def call_tool(*, system: str, payload: dict, tool_name: str, description: str,
                    parameters: dict, handler: Callable[[dict], Any | Awaitable[Any]],
                    model: str | None = None) -> dict:
    """Require a real function call, execute the domain handler, and return its result."""
    tool = {"type": "function", "function": {"name": tool_name, "description": description,
             "parameters": parameters, "strict": True}}
    response = await asyncio.wait_for(_client.chat.completions.create(
        model=model or get_settings().openai_model,
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": json.dumps(payload, ensure_ascii=False, separators=(",", ":"))}],
        tools=[tool], tool_choice={"type": "function", "function": {"name": tool_name}},
        parallel_tool_calls=False, temperature=0.2), timeout=9.0)
    calls = response.choices[0].message.tool_calls or []
    if not calls or calls[0].function.name != tool_name:
        raise RuntimeError(f"LLM did not call required tool {tool_name}")
    arguments = json.loads(calls[0].function.arguments)
    result = handler(arguments)
    if hasattr(result, "__await__"):
        result = await result
    if not isinstance(result, dict):
        raise TypeError(f"Tool {tool_name} must return an object")
    return result
