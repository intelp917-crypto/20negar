from __future__ import annotations

from pathlib import Path
import os
import shutil
import time

from .health_monitor import HealthMonitor, HealthResult
from .process_manager import ProcessIdentity, ProcessManager


class ServerController:
    """Owns the lifecycle of the managed Node.js server process.

    The controller is the single source of truth for the lifecycle phase used by
    the UI, so the play/stop control can never drift away from reality.
    """

    def __init__(self, command: list[str], cwd: Path | None = None,
                 health_url: str = "http://127.0.0.1:3000/api/health",
                 process_manager: ProcessManager | None = None,
                 env: dict[str, str] | None = None, startup_timeout: float = 30.0):
        self.command, self.cwd, self.health_url = command, cwd, health_url
        self.process_manager = process_manager or ProcessManager()
        self.env = env or {}
        self.startup_timeout = startup_timeout
        self.identity: ProcessIdentity | None = None
        self.started_at: float | None = None
        self._stopping = False
        self.last_health: HealthResult | None = None

    # -- lifecycle ---------------------------------------------------------
    def start(self) -> ProcessIdentity:
        if self.identity and self.process_manager.is_alive(self.identity):
            return self.identity
        self._stopping = False
        self.identity = self.process_manager.start(self.command, self.cwd, self.env)
        self.started_at = time.time()
        return self.identity

    def adopt(self, pid: int, process_started_at: float | None = None) -> bool:
        """Re-attach to a server started by an earlier manager session."""
        if not pid:
            return False
        identity = ProcessIdentity(pid, tuple(str(x) for x in self.command),
                                   time.time(), process_started_at)
        if not self.process_manager.identity_matches(identity):
            return False
        self.identity = identity
        self.started_at = process_started_at or time.time()
        self._stopping = False
        return True

    def stop(self, timeout: float = 5.0) -> bool:
        if not self.identity:
            self._stopping = False
            return True
        self._stopping = True
        try:
            result = self.process_manager.stop(self.identity, timeout)
        finally:
            self._stopping = False
        # Keep the identity on failure so the operator can retry the stop.
        if result:
            self.identity = None
            self.started_at = None
        return result

    def is_running(self) -> bool:
        return bool(self.identity and self.process_manager.is_alive(self.identity))

    # -- observation -------------------------------------------------------
    def probe(self, timeout: float = 1.5) -> HealthResult:
        result = HealthMonitor().check(self.health_url, timeout=timeout)
        self.last_health = result
        return result

    def uptime(self) -> float:
        return max(0.0, time.time() - self.started_at) if self.started_at else 0.0

    def status(self) -> dict:
        process = self.process_manager.snapshot(self.identity)
        running = bool(process.get("running"))
        result = self.probe()
        health = {"ok": result.healthy, "status_code": result.status,
                  "error": result.error, "latency_ms": result.latency_ms}
        uptime = self.uptime()
        if self._stopping:
            phase = "stopping"
        elif running and result.healthy:
            phase = "running"
        elif running:
            phase = "starting" if uptime < self.startup_timeout else "unhealthy"
        elif result.healthy:
            # The server answers but this manager did not spawn it (or lost the
            # handle). It is still fully controllable through the health probe.
            phase = "external"
        else:
            phase = "stopped"
        return {
            **process,
            "phase": phase,
            "uptime": uptime,
            "health": health,
            "status": phase,
            "managed": bool(running),
        }

    @staticmethod
    def command_for_repo(repo: Path, mode: str = "development", node: str | None = None) -> list[str]:
        node_exe = node or shutil.which("node") or shutil.which("node.exe")
        if not node_exe:
            raise FileNotFoundError("Node.js executable was not found")
        tsx = repo / "node_modules" / "tsx" / "dist" / "cli.mjs"
        if tsx.exists():
            # Absolute so a sign-in entry that starts elsewhere still resolves it.
            return [node_exe, str(tsx), str(repo / "server.ts")]
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm") or "npm"
        return [npm, "run", "start" if mode == "production" else "dev"]
