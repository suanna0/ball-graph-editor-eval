"""The agent loop: prompt -> model -> tool calls -> repeat, until the worker
calls finish, the model ends its turn, or a rollout limit is hit.

Provider-agnostic (2026-11-19): this loop only ever touches the neutral
shapes in runtime/providers/base.py (ModelResponse, ToolCall, ToolResult,
Usage). Everything provider-specific -- wire format, field names, how
conversation history is threaded between turns -- lives inside whichever
Provider implementation is passed in (runtime/providers/{anthropic,
openrouter}_provider.py). Mirrors extractor/src/adapters/*.ts: many wire
formats in, one canonical shape for the code that doesn't need to care
which one produced it."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from runtime.providers.base import ContentBlock, Provider, ToolResult


class EventLog:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._f = open(path, "w")

    def log(self, kind: str, **fields: Any) -> None:
        self._f.write(json.dumps({"ts": time.time(), "kind": kind, **fields}, default=str) + "\n")
        self._f.flush()

    def close(self) -> None:
        self._f.close()


def _to_content_blocks(raw_result: Any) -> list[ContentBlock]:
    """tool_bridge.call() returns either a plain string, or (for
    render_graph) a list of neutral {"type": "text"/"image", ...} dicts --
    see runtime/tools.py."""
    if isinstance(raw_result, str):
        return [ContentBlock(type="text", text=raw_result)]
    blocks = []
    for item in raw_result:
        if item["type"] == "text":
            blocks.append(ContentBlock(type="text", text=item["text"]))
        elif item["type"] == "image":
            blocks.append(ContentBlock(type="image", media_type=item["media_type"], data=item["data"]))
    return blocks


def run_agent(
    *,
    provider: Provider,
    model: str,
    max_tokens: int,
    prompt_text: str,
    tool_specs: list[dict],
    tool_bridge,
    max_turns: int,
    wall_clock_seconds: int,
    max_tool_calls: int,
    max_output_tokens: int,
    event_log: EventLog,
    **provider_config: Any,
) -> dict:
    event_log.log("prompt", content=prompt_text)
    history = provider.start(prompt_text)

    start = time.time()
    turns = 0
    tool_calls = 0
    usage_totals = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0}
    final_stop: str | None = None

    def hit_limit(name: str) -> str:
        event_log.log("limit_hit", reason=name)
        return f"limit_{name}"

    while turns < max_turns:
        if time.time() - start > wall_clock_seconds:
            final_stop = hit_limit("wall_clock")
            break
        if usage_totals["output_tokens"] > max_output_tokens:
            final_stop = hit_limit("output_tokens")
            break

        turns += 1
        event_log.log("model_request", turn=turns)
        response, history = provider.send(
            history, tool_specs, model=model, max_tokens=max_tokens, **provider_config
        )

        usage_totals["input_tokens"] += response.usage.input_tokens
        usage_totals["output_tokens"] += response.usage.output_tokens
        usage_totals["cache_read_input_tokens"] += response.usage.cache_read_input_tokens

        event_log.log(
            "model_response",
            turn=turns,
            stop_reason=response.stop_reason,
            content=response.raw,
        )

        if response.stop_reason != "tool_use":
            final_stop = response.stop_reason
            break

        tool_results: list[ToolResult] = []
        over_budget = False
        for call in response.tool_calls:
            tool_calls += 1
            if tool_calls > max_tool_calls:
                tool_results.append(ToolResult(
                    tool_call_id=call.id,
                    content=[ContentBlock(type="text", text="tool-call budget exhausted")],
                    is_error=True,
                ))
                over_budget = True
                continue

            event_log.log("tool_call", id=call.id, name=call.name, input=call.input)
            try:
                raw_result = tool_bridge.call(call.name, call.input)
                tool_results.append(ToolResult(
                    tool_call_id=call.id,
                    content=_to_content_blocks(raw_result),
                ))
                event_log.log("tool_result", id=call.id, ok=True)
            except Exception as e:
                tool_results.append(ToolResult(
                    tool_call_id=call.id,
                    content=[ContentBlock(type="text", text=f"{type(e).__name__}: {e}")],
                    is_error=True,
                ))
                event_log.log("tool_result", id=call.id, ok=False, error=str(e))

        history = provider.append_tool_results(history, tool_results)

        if getattr(tool_bridge, "finished", False):
            final_stop = "finish"
            break
        if over_budget:
            final_stop = hit_limit("tool_calls")
            break

    if final_stop is None:
        final_stop = hit_limit("turns")

    return {
        "stop_reason": final_stop,
        "turns": turns,
        "tool_calls": tool_calls,
        "usage": usage_totals,
        "wall_clock_seconds": time.time() - start,
        "finish_note": getattr(tool_bridge, "finish_note", None),
    }
