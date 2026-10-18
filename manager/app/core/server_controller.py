from pathlib import Path
import os
import shutil
import time
from .health_monitor import HealthMonitor
from .process_manager import ProcessIdentity, ProcessManager


class ServerController:
    def __init__(self, command: list[str], cwd: Path | None = None, health_url: str = "http://127.0.0.1:3000/api/health", process_manager: ProcessManager | None = None, env: dict[str, str] | None = None):
        self.command, self.cwd, self.health_url = command, cwd, health_url
        self.process_manager = process_manager or ProcessManager(); self.env = env
        self.identity: ProcessIdentity | None = None
        self.started_at: float | None = None

    def start(self) -> ProcessIdentity:
        if self.identity and self.process_manager.is_alive(self.identity): return self.identity
        self.identity = self.process_manager.start(self.command, self.cwd, self.env)
        self.started_at = time.time()
        return self.identity

    def stop(self, timeout: float = 5.0) -> bool:
        if not self.identity: return True
        result = self.process_manager.stop(self.identity, timeout); self.identity = None; self.started_at = None
        return result

    def is_running(self) -> bool:
        return bool(self.identity and self.process_manager.is_alive(self.identity))

    def status(self) -> dict:
        process = self.process_manager.snapshot(self.identity)
        result = HealthMonitor().check(self.health_url) if process.get("running") else None
        health = {"ok": result.healthy, "status_code": result.status, "error": result.error} if result else {"ok": False, "status": "stopped"}
        return {**process, "health": health, "status": "running" if process.get("running") and health.get("ok") else ("unhealthy" if process.get("running") else "stopped")}

    @staticmethod
    def command_for_repo(repo: Path, mode: str = "development", node: str | None = None) -> list[str]:
        node_exe = node or shutil.which("node") or shutil.which("node.exe")
        if not node_exe:
            raise FileNotFoundError("Node.js executable was not found")
        tsx = repo / "node_modules" / "tsx" / "dist" / "cli.mjs"
        if tsx.exists(): return [node_exe, str(tsx), "server.ts"]
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm") or "npm"
        return [npm, "run", "start" if mode == "production" else "dev"]
