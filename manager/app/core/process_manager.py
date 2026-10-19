from dataclasses import dataclass
from pathlib import Path
import os
import threading
import subprocess
import time

try:
    import psutil
except ImportError:  # pragma: no cover
    psutil = None


@dataclass
class ProcessIdentity:
    pid: int
    command: tuple[str, ...]
    started_at: float
    process_started_at: float | None = None


class ProcessManager:
    def __init__(self, popen_factory=subprocess.Popen):
        self._popen = popen_factory; self._last_process = None; self._reader_started = False

    def start(self, command: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> ProcessIdentity:
        # CREATE_NO_WINDOW keeps the Node console invisible when the manager itself
        # is a GUI build, while the merged output pipe still carries every line.
        creationflags = 0
        if os.name == "nt":
            creationflags = (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                             | getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000))
        merged_env = os.environ.copy(); merged_env.update(env or {})
        proc = self._popen(command, cwd=str(cwd) if cwd else None, env=merged_env, shell=False,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                           creationflags=creationflags, text=True, bufsize=1, errors="replace")
        self._last_process = proc
        # A restart creates a new process: its stream must be read again.
        self._reader_started = False
        started = time.time()
        process_started = None
        if psutil:
            try: process_started = psutil.Process(proc.pid).create_time()
            except (psutil.Error, OSError): pass
        return ProcessIdentity(proc.pid, tuple(command), started, process_started)

    def start_output_reader(self, callback) -> None:
        """Read the merged stdout/stderr stream exactly once per process."""
        proc = self._last_process
        if not proc or not proc.stdout or self._reader_started: return
        self._reader_started = True
        def read():
            for line in iter(proc.stdout.readline, ""):
                callback(line)
            try:
                proc.stdout.close()
            except (OSError, ValueError):
                pass
        threading.Thread(target=read, name="manager-process-output", daemon=True).start()

    def identity_matches(self, identity: ProcessIdentity) -> bool:
        if psutil:
            try:
                process = psutil.Process(identity.pid)
                if not process.is_running(): return False
                if identity.process_started_at is not None and abs(process.create_time() - identity.process_started_at) > 2:
                    return False
                actual = tuple(process.cmdline())
                expected = tuple(str(x) for x in identity.command)
                return bool(actual) and (actual == expected or all(part in actual for part in expected))
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
                    "memory_percent": process.memory_percent() if process else 0,
                    "cmdline": process.cmdline() if process else list(identity.command)}
        except (OSError, psutil.Error if psutil else OSError):
            return {"running": True, "pid": identity.pid, "started_at": identity.started_at}

    @staticmethod
    def is_pid_alive(pid: int) -> bool:
        if not psutil: return False
        try: return psutil.pid_exists(pid) and psutil.Process(pid).is_running()
        except (psutil.Error, OSError): return False
