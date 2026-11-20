"""Anthropic Messages API, wrapped behind the neutral Provider interface
(runtime/providers/base.py). `history` here is the native `messages` list
the Messages API expects -- opaque to runtime/agent.py, private to this
module.

This is the previously-hardcoded behavior from runtime/agent.py (streaming
via client.messages.stream(...).get_final_message(), per the 2026-11-19
fix for max_tokens >= the SDK's non-streaming time-limit threshold), moved
here unchanged except for the translation to/from the neutral shapes.
"""
from __future__ import annotations

from typing import Any

from .base import ContentBlock, ModelResponse, ToolCall, ToolResult, Usage


def _block_to_jsonable(block: Any) -> Any:
    if hasattr(block, "model_dump"):
        return block.model_dump()
    return block


class AnthropicProvider:
    def __init__(self, client, thinking: dict | None = None, output_config: dict | None = None):
        self.client = client
        self.thinking = thinking
        self.output_config = output_config

    def start(self, prompt_text: str) -> list[dict]:
        return [{"role": "user", "content": prompt_text}]

    def send(self, history, tools, *, model, max_tokens, **config):
        req: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "tools": tools,  # already Anthropic-shaped: {name, description, input_schema}
            "messages": history,
        }
        if self.thinking:
            req["thinking"] = self.thinking
        if self.output_config:
            req["output_config"] = self.output_config

        # Streaming, not a plain create(): once max_tokens is large enough
        # that a request could plausibly run past 10 minutes, the SDK
        # requires streaming and raises otherwise. get_final_message()
        # still returns the same assembled Message shape create() would.
        with self.client.messages.stream(**req) as stream:
            resp = stream.get_final_message()

        tool_calls = [
            ToolCall(id=b.id, name=b.name, input=b.input)
            for b in resp.content if b.type == "tool_use"
        ]
        text = "".join(b.text for b in resp.content if b.type == "text")
        usage = Usage(
            input_tokens=getattr(resp.usage, "input_tokens", 0) or 0,
            output_tokens=getattr(resp.usage, "output_tokens", 0) or 0,
            cache_read_input_tokens=getattr(resp.usage, "cache_read_input_tokens", 0) or 0,
        )
        response = ModelResponse(
            stop_reason=resp.stop_reason,
            text=text,
            tool_calls=tool_calls,
            usage=usage,
            raw=[_block_to_jsonable(b) for b in resp.content],
        )
        new_history = history + [{"role": "assistant", "content": resp.content}]
        return response, new_history

    def append_tool_results(self, history, results: list[ToolResult]):
        content = [
            {
                "type": "tool_result",
                "tool_use_id": r.tool_call_id,
                "is_error": r.is_error,
                "content": _blocks_to_anthropic(r.content),
            }
            for r in results
        ]
        return history + [{"role": "user", "content": content}]


def _blocks_to_anthropic(blocks: list[ContentBlock]) -> list[dict]:
    out = []
    for b in blocks:
        if b.type == "text":
            out.append({"type": "text", "text": b.text})
        elif b.type == "image":
            out.append({
                "type": "image",
                "source": {"type": "base64", "media_type": b.media_type, "data": b.data},
            })
    return out
