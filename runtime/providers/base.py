"""Provider-neutral shapes for the agent loop (runtime/agent.py). Every
module in this package implements the same two jobs for one wire protocol:
serialize a neutral request into that protocol's shape, and parse its raw
response back into these neutral dataclasses. runtime/agent.py only ever
touches these -- never a provider-specific field name.

Mirrors extractor/src/adapters/*.ts: many wire formats in (CSS/GSAP/Lottie
there, Anthropic/OpenAI-style here), one canonical shape for the code that
doesn't need to care which one produced it.

`history` (passed to and returned from every Provider method below) is
deliberately untyped (Any) and OPAQUE to the agent loop -- its shape is
private to whichever provider created it. The loop just threads it from
one call to the next; it never inspects or builds it directly. This is
what lets each provider keep its own native conversation format (Anthropic
needs assistant turns echoed back with thinking blocks intact; OpenAI-style
needs separate role="tool" messages) without leaking that shape upward.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict


@dataclass
class ContentBlock:
    """One item of a tool result's content. type is "text" or "image";
    only the matching fields are set."""
    type: str
    text: str | None = None
    media_type: str | None = None
    data: str | None = None  # base64, for images


@dataclass
class ToolResult:
    tool_call_id: str
    content: list[ContentBlock]
    is_error: bool = False


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0  # 0 for providers with no caching concept


@dataclass
class ModelResponse:
    # "tool_use" is the only value runtime/agent.py's loop branches on --
    # anything else ends the rollout, so a provider can pass its own
    # terminal reason straight through (e.g. "refusal", "content_filter")
    # and it'll just be recorded as the stop reason, not misread as a
    # request to keep going.
    stop_reason: str
    text: str
    tool_calls: list[ToolCall]
    usage: Usage
    # The provider's own raw response, jsonable, for event-log debugging
    # only. runtime/agent.py logs it blindly; nothing branches on its shape.
    raw: Any = None


class Provider(Protocol):
    def start(self, prompt_text: str) -> Any:
        """Build the initial (opaque) history from the rendered brief."""
        ...

    def send(
        self, history: Any, tools: list[dict], *, model: str, max_tokens: int, **config: Any
    ) -> tuple[ModelResponse, Any]:
        """Call the model. Returns (neutral response, updated history --
        already including the assistant's turn, ready for the next call)."""
        ...

    def append_tool_results(self, history: Any, results: list[ToolResult]) -> Any:
        """Return history with these tool results appended, ready for the
        next send()."""
        ...
