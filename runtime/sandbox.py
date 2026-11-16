"""One Docker container per rollout.

Design: the per-rollout state lives in a host-side temp dir ("stage") that
we bind-mount into the container at /work. File ops (read_file, write_file,
list_dir, render_graph) are served from the host side of the mount, which is
fast and lets us snapshot the final state by copying the directory. Shell
commands run inside the container via `docker exec`, so anything the worker
spawns is properly isolated.

Image defaults to `node:20-bookworm-slim` -- the v1 authoring frameworks
(CSS, GSAP via CDN script, Lottie JSON) are buildless, so no browser or
bundler is needed inside the worker container. Curve extraction (which does
need a browser) runs separately, on the host/grader side, against a frozen
snapshot -- never inside this container.
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path


_FINAL_IGNORE = shutil.ignore_patterns("node_modules", "dist", ".vite", ".cache")

_DEFAULT_IMAGE = "node:20-bookworm-slim"


class DockerUnavailableError(RuntimeError):
    pass


class DockerSandbox:
    def __init__(
        self,
        image: str = _DEFAULT_IMAGE,
        memory: str = "2g",
        cpus: str = "2",
        pids_limit: int = 512,
    ):
        self.image = image
        self.memory = memory
        self.cpus = cpus
        self.pids_limit = pids_limit
        self.stage = Path(tempfile.mkdtemp(prefix="rollout_"))
        self.work = self.stage / "work"
        self.container = f"rollout_{uuid.uuid4().hex[:12]}"
        self._started = False

    def seed(self, scaffold_source: Path) -> None:
        shutil.copytree(scaffold_source, self.work)
        self._start_container()

    def _start_container(self) -> None:
        cmd = [
            "docker", "run", "-d",
            "--name", self.container,
            "-v", f"{self.work.resolve()}:/work",
            "-w", "/work",
            "--memory", self.memory,
            "--cpus", self.cpus,
            "--pids-limit", str(self.pids_limit),
            self.image,
            "sleep", "infinity",
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True)
        except FileNotFoundError as e:
            raise DockerUnavailableError(
                "docker CLI not found; install Docker Desktop or set it on PATH"
            ) from e
        if res.returncode != 0:
            raise DockerUnavailableError(
                f"docker run failed ({res.returncode}): {res.stderr.strip()}"
            )
        self._started = True

    def exec_bash(
        self,
        command: str,
        timeout: int,
    ) -> tuple[int, str, str] | None:
        """Run `command` in the container. Returns (exit_code, stdout, stderr)
        or None on timeout."""
        if not self._started:
            raise RuntimeError("container not started; call seed() first")
        try:
            proc = subprocess.run(
                ["docker", "exec", "-w", "/work", self.container, "bash", "-lc", command],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return None
        return proc.returncode, proc.stdout, proc.stderr

    def contains(self, p: Path) -> bool:
        try:
            Path(p).resolve().relative_to(self.work.resolve())
            return True
        except ValueError:
            return False

    def copy_final_to(self, dest: Path) -> None:
        shutil.copytree(self.work, dest, ignore=_FINAL_IGNORE)

    def cleanup(self) -> None:
        if self._started:
            subprocess.run(
                ["docker", "rm", "-f", self.container],
                check=False,
                capture_output=True,
            )
            self._started = False
        shutil.rmtree(self.stage, ignore_errors=True)
