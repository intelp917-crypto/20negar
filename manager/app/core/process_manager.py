from dataclasses import dataclass
from pathlib import Path
import os
import subprocess
import time
import os

try:
    import psutil
except ImportError:  # pragma: no cover
    psutil = None


@dataclass
class ProcessIdentity:
    pid: int
    command: tuple[str, ...]
    started_at: float


class ProcessManager:
    def __init__(self, popen_factory=subprocess.Popen): self._popen = popen_factory; self._last_process = None

    def start(self, command: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> ProcessIdentity:
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else 0
        proc = self._popen(command, cwd=str(cwd) if cwd else None, env=env, shell=False,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
                           creationflags=creationflags, text=True, bufsize=1)
        self._last_process = proc
        return ProcessIdentity(proc.pid, tuple(command), time.time())

    def identity_matches(self, identity: ProcessIdentity) -> bool:
        if psutil:
            try:
                process = psutil.Process(identity.pid)
                if not process.is_running(): return False
                actual = tuple(process.cmdline())
                return not actual or any(part in actual for part in identity.command) or identity.command[0] in " ".join(actual)
            except (psutil.Error, OSError): return False
        return False

    def is_alive(self, identity: ProcessIdentity) -> bool:
        return self.identity_matches(identity)

    def descendants(self, pid: int) -> list[int]:
        if not psutil: return []
        try: return [p.pid for p in psutil.Process(pid).children(recursive=True)]
        except (psutil.Error, OSError): return []

    def stop(self, identity: ProcessIdentity, timeout: float = 5.0) -> bool:
        if not self.is_alive(identity): return True
        targets = [identity.pid, *self.descendants(identity.pid)]
        if psutil:
            for pid in targets:
                try: psutil.Process(pid).terminate()
                except (psutil.Error, OSError): pass
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline and any(self.is_pid_alive(p) for p in targets): time.sleep(.05)
            for pid in targets:
                if self.is_pid_alive(pid):
                    try: psutil.Process(pid).kill()
                    except (psutil.Error, OSError): pass
        return not any(self.is_pid_alive(p) for p in targets)

    def snapshot(self, identity: ProcessIdentity | None) -> dict:
        if not identity or not self.is_alive(identity):
            return {"running": False}
        try:
            process = psutil.Process(identity.pid) if psutil else None
            return {"running": True, "pid": identity.pid, "started_at": identity.started_at,
                    "cpu_percent": process.cpu_percent(interval=None) if process else 0,
                    "memory_bytes": process.memory_info().rss if process else 0,
                    "cmdline": process.cmdline() if process else list(identity.command)}
        except (OSError, psutil.Error if psutil else OSError):
            return {"running": True, "pid": identity.pid, "started_at": identity.started_at}

    @staticmethod
    def is_pid_alive(pid: int) -> bool:
        if not psutil: return False
        try: return psutil.pid_exists(pid) and psutil.Process(pid).is_running()
        except (psutil.Error, OSError): return False
