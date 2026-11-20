"""make_provider() is the one place that knows which wire protocols exist.
Add a new protocol by adding a branch here and a module next to this one --
runtime/agent.py and runtime/rollout.py never need to change."""
from __future__ import annotations

import sys

from .base import ContentBlock, ModelResponse, Provider, ToolCall, ToolResult, Usage

__all__ = [
    "ContentBlock", "ModelResponse", "Provider", "ToolCall", "ToolResult", "Usage",
    "make_provider",
]


def make_provider(provider_name: str, *, thinking: dict | None = None, output_config: dict | None = None) -> Provider:
    if provider_name == "anthropic":
        from anthropic import Anthropic

        from .anthropic_provider import AnthropicProvider
        return AnthropicProvider(Anthropic(), thinking=thinking, output_config=output_config)

    if provider_name == "openrouter":
        import os

        from openai import OpenAI

        from .openrouter_provider import OpenRouterProvider
        if thinking or output_config:
            print(
                "warning: runner.yaml's worker.thinking/output_config are Anthropic-specific "
                "and are ignored under provider: openrouter",
                file=sys.stderr,
            )
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY is not set (add it to .env)")
        return OpenRouterProvider(OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key))

    raise ValueError(f"unknown provider: {provider_name!r} (expected 'anthropic' or 'openrouter')")
