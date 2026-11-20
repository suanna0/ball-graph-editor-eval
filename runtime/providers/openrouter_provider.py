"""OpenRouter, via its OpenAI-compatible /chat/completions endpoint,
wrapped behind the neutral Provider interface (runtime/providers/base.py).
This is the one adapter that covers every non-Anthropic model family --
GPT, Gemini, Llama, etc. -- since OpenRouter normalizes all of them into
this same wire shape. `history` here is the native OpenAI-style
`messages` list -- opaque to runtime/agent.py, private to this module.

No extended-thinking equivalent is wired through here: that's an
Anthropic-specific concept (runner.yaml's `thinking`/`output_config`), and
most models this adapter reaches don't expose reasoning the same way.
make_provider() (runtime/providers/__init__.py) warns if those keys are
set with this provider, rather than silently ignoring a likely config
mistake.
"""
from __future__ import annotations

import json
from typing import Any

from .base import ContentBlock, ModelResponse, ToolCall, ToolResult, Usage


class OpenRouterProvider:
    def __init__(self, client):
        self.client = client  # openai.OpenAI(base_url="https://openrouter.ai/api/v1", ...)

    def start(self, prompt_text: str) -> list[dict]:
        return [{"role": "user", "content": prompt_text}]

    def send(self, history, tools, *, model, max_tokens, **config):
        resp = self.client.chat.completions.create(
            model=model,
            max_tokens=max_tokens,
            messages=history,
            tools=[_to_openai_tool(t) for t in tools],
        )
        choice = resp.choices[0]
        msg = choice.message

        tool_calls = [
            ToolCall(id=tc.id, name=tc.function.name, input=json.loads(tc.function.arguments or "{}"))
            for tc in (msg.tool_calls or [])
        ]
        stop_reason = "tool_use" if choice.finish_reason == "tool_calls" else choice.finish_reason
        usage = resp.usage
        response = ModelResponse(
            stop_reason=stop_reason,
            text=msg.content or "",
            tool_calls=tool_calls,
            usage=Usage(
                input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
                output_tokens=getattr(usage, "completion_tokens", 0) or 0,
                cache_read_input_tokens=0,
            ),
            raw=msg.model_dump() if hasattr(msg, "model_dump") else msg,
        )
        assistant_entry = msg.model_dump() if hasattr(msg, "model_dump") else dict(msg)
        new_history = history + [assistant_entry]
        return response, new_history

    def append_tool_results(self, history, results: list[ToolResult]):
        out = list(history)
        for r in results:
            text_parts = [b.text for b in r.content if b.type == "text" and b.text]
            image_parts = [b for b in r.content if b.type == "image"]
            if image_parts:
                # A vision-capable model takes tool content as a block
                # array; a model that can't take images at all will reject
                # the request outright, which is the right failure mode --
                # silently dropping the image would quietly turn this into
                # a blind run instead of erroring where it's obvious why.
                content: Any = [{"type": "text", "text": t} for t in text_parts] + [
                    {"type": "image_url", "image_url": {"url": f"data:{b.media_type};base64,{b.data}"}}
                    for b in image_parts
                ]
            else:
                content = "\n".join(text_parts)
            out.append({
                "role": "tool",
                "tool_call_id": r.tool_call_id,
                "content": content,
            })
        return out


def _to_openai_tool(spec: dict) -> dict:
    return {
        "type": "function",
        "function": {
            "name": spec["name"],
            "description": spec.get("description", ""),
            "parameters": spec.get("input_schema", {"type": "object", "properties": {}}),
        },
    }
