"""Minimal .env loader. No dependency.

Reads KEY=VALUE lines, skips blanks and `# comments`. Values may be wrapped
in matching single or double quotes, which are stripped. Does not expand
shell variables. Existing environment values win: a key already set in the
process environment is never overwritten."""
from __future__ import annotations

import os
from pathlib import Path


def load_dotenv(path: Path) -> list[str]:
    if not path.is_file():
        return []
    loaded: list[str] = []
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value
            loaded.append(key)
    return loaded
