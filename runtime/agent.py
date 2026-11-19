"""The agent loop: prompt -> model -> tool calls -> repeat, until the worker
calls finish, the model ends its turn, or a rollout limit is hit."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any


class EventLog:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._f = open(path, "w")

    def log(self, kind: str, **fields: Any) -> None:
        self._f.write(json.dumps({"ts": time.time(), "kind": kind, **fields}) + "\n")
        self._f.flush()

    def close(self) -> None:
        self._f.close()


def _block_to_jsonable(block) -> Any:
    if hasattr(block, "model_dump"):
        return block.model_dump()
    return block


def run_agent(
    *,
    client,
    model: str,
    max_tokens: int,
    thinking: dict | None,
    output_config: dict | None,
    prompt_text: str,
    tool_specs: list[dict],
    tool_bridge,
    max_turns: int,
    wall_clock_seconds: int,
    max_tool_calls: int,
    max_output_tokens: int,
    event_log: EventLog,
) -> dict:
    messages: list[dict] = [{"role": "user", "content": prompt_text}]
    event_log.log("prompt", content=prompt_text)

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
        req = {
            "model": model,
            "max_tokens": max_tokens,
            "tools": tool_specs,
            "messages": messages,
        }
        if thinking:
            req["thinking"] = thinking
        if output_config:
            req["output_config"] = output_config

        event_log.log("model_request", turn=turns)
        # Streaming, not a plain create() call: once max_tokens is large
        # enough that a request could plausibly run past 10 minutes (true
        # here, with adaptive thinking at high effort), the SDK requires
        # streaming and raises otherwise. get_final_message() still
        # returns the same assembled Message shape .create() would, so
        # nothing below this line needs to change.
        with client.messages.stream(**req) as stream:
            resp = stream.get_final_message()

        for k in usage_totals:
            usage_totals[k] += getattr(resp.usage, k, 0) or 0

        assistant_jsonable = [_block_to_jsonable(b) for b in resp.content]
        event_log.log(
            "model_response",
            turn=turns,
            stop_reason=resp.stop_reason,
            content=assistant_jsonable,
        )
        messages.append({"role": "assistant", "content": resp.content})

        if resp.stop_reason != "tool_use":
            final_stop = resp.stop_reason
            break

        tool_results = []
        over_budget = False
        for block in resp.content:
            if block.type != "tool_use":
                continue
            tool_calls += 1
            if tool_calls > max_tool_calls:
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "is_error": True,
                    "content": "tool-call budget exhausted",
                })
                over_budget = True
                continue

            event_log.log("tool_call", id=block.id, name=block.name, input=block.input)
            try:
                result = tool_bridge.call(block.name, block.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                })
                event_log.log("tool_result", id=block.id, ok=True)
            except Exception as e:
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "is_error": True,
                    "content": f"{type(e).__name__}: {e}",
                })
                event_log.log("tool_result", id=block.id, ok=False, error=str(e))

        messages.append({"role": "user", "content": tool_results})

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
