"""Tool specs sent to the model, and the host-side bridge that runs them
against the sandbox.

`render_graph` is the optional worker-facing preview tool for the
`can_render_and_view_graph` feedback mode. It shells out to the *same*
extractor code the grader uses, but against the worker's live files in its
own sandbox -- a preview aid only. It never writes anything the grader
later trusts: the official grade always re-extracts from scratch against
the frozen `final/` snapshot after the rollout ends (see runtime/rollout.py
and grader/grade.py), so nothing this tool does can influence the score.
"""
from __future__ import annotations

import base64
import subprocess
from pathlib import Path

_MAX_READ_BYTES = 200_000
_MAX_BASH_OUT = 16_000
_DEFAULT_BASH_TIMEOUT = 120
_RENDER_GRAPH_TIMEOUT = 60

_REPO_ROOT = Path(__file__).resolve().parents[1]
_RENDER_GRAPH_TOOL_SCRIPT = _REPO_ROOT / "extractor" / "src" / "render-graph-tool.ts"

_ALL_SPECS: dict[str, dict] = {
    "read_file": {
        "name": "read_file",
        "description": "Read a UTF-8 text file under /work. Returns the file contents.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Path relative to /work."}},
            "required": ["path"],
        },
    },
    "write_file": {
        "name": "write_file",
        "description": "Create or overwrite a UTF-8 text file under /work.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
    "list_dir": {
        "name": "list_dir",
        "description": "List the contents of a directory under /work. Use '.' for the root.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    "bash": {
        "name": "bash",
        "description": (
            "Run a shell command with /work as the working directory. Returns "
            "exit code, stdout and stderr."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "timeout_seconds": {"type": "integer", "description": "Default 120."},
            },
            "required": ["command"],
        },
    },
    "render_graph": {
        "name": "render_graph",
        "description": (
            "Render your current animation's keyframes and Bezier handles as a "
            "graph-editor style plot (one lane per property: x, y, scaleX, scaleY, "
            "rotation) and return it as an image so you can inspect your curves. "
            "This does not render the animation itself, only the curve shapes."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    "finish": {
        "name": "finish",
        "description": "Signal the task is complete.",
        "input_schema": {
            "type": "object",
            "properties": {
                "note": {"type": "string", "description": "Optional short summary of what you built."},
            },
        },
    },
}


def tool_specs(enabled_tools: list[str]) -> list[dict]:
    try:
        return [_ALL_SPECS[name] for name in enabled_tools]
    except KeyError as e:
        raise ValueError(f"unknown tool in feedback_mode config: {e}") from e


class ToolBridge:
    def __init__(self, sandbox, framework: str):
        self.sandbox = sandbox
        self.framework = framework
        self.finished = False
        self.finish_note: str | None = None

    def _resolve(self, rel: str) -> Path:
        p = (self.sandbox.work / rel).resolve()
        if not self.sandbox.contains(p):
            raise ValueError(f"path escapes sandbox: {rel}")
        return p

    def call(self, name: str, args: dict):
        """Return value is either a string (plain text tool_result content)
        or a list of content blocks (used by render_graph to return an image)."""
        if name == "read_file":
            return self._read_file(args["path"])
        if name == "write_file":
            return self._write_file(args["path"], args["content"])
        if name == "list_dir":
            return self._list_dir(args["path"])
        if name == "bash":
            return self._bash(args["command"], args.get("timeout_seconds", _DEFAULT_BASH_TIMEOUT))
        if name == "render_graph":
            return self._render_graph()
        if name == "finish":
            self.finished = True
            self.finish_note = args.get("note", "")
            return "acknowledged"
        raise ValueError(f"unknown tool: {name}")

    def _read_file(self, rel: str) -> str:
        p = self._resolve(rel)
        if not p.is_file():
            raise ValueError(f"not a file: {rel}")
        data = p.read_bytes()
        if len(data) > _MAX_READ_BYTES:
            raise ValueError(f"file too large ({len(data)} bytes); max {_MAX_READ_BYTES}")
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError as e:
            raise ValueError("file is not UTF-8 text") from e

    def _write_file(self, rel: str, content: str) -> str:
        p = self._resolve(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        return f"wrote {len(content)} chars to {rel}"

    def _list_dir(self, rel: str) -> str:
        p = self._resolve(rel)
        if not p.is_dir():
            raise ValueError(f"not a directory: {rel}")
        entries = []
        for child in sorted(p.iterdir()):
            entries.append(f"{child.name}/" if child.is_dir() else child.name)
        return "\n".join(entries) if entries else "(empty)"

    def _bash(self, command: str, timeout: int) -> str:
        result = self.sandbox.exec_bash(command, timeout)
        if result is None:
            return f"$ {command}\n[timeout after {timeout}s]"
        code, stdout, stderr = result

        def clip(s: str) -> str:
            if len(s) <= _MAX_BASH_OUT:
                return s
            return s[:_MAX_BASH_OUT] + f"\n[...clipped, {len(s) - _MAX_BASH_OUT} more chars]"

        return (
            f"$ {command}\n"
            f"exit_code: {code}\n"
            f"--- stdout ---\n{clip(stdout)}\n"
            f"--- stderr ---\n{clip(stderr)}"
        )

    def _render_graph(self):
        try:
            proc = subprocess.run(
                ["npx", "tsx", str(_RENDER_GRAPH_TOOL_SCRIPT), str(self.sandbox.work), self.framework],
                capture_output=True,
                text=True,
                timeout=_RENDER_GRAPH_TIMEOUT,
                cwd=_REPO_ROOT,
            )
        except subprocess.TimeoutExpired:
            return "render_graph timed out; keep working and try again later"
        if proc.returncode != 0:
            return f"render_graph failed:\n{proc.stderr[-2000:]}"
        b64 = proc.stdout.strip()
        return [{
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": b64},
        }]
