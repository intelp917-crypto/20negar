from dataclasses import dataclass
import socket
import time
import urllib.error
import urllib.request


@dataclass
class HealthResult:
    healthy: bool
    status: int | None = None
    error: str | None = None
    latency_ms: int | None = None


class HealthMonitor:
    def check(self, url: str, timeout: float = 1.5) -> HealthResult:
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                latency = int((time.perf_counter() - started) * 1000)
                return HealthResult(200 <= response.status < 400, response.status, None, latency)
        except urllib.error.HTTPError as exc:
            latency = int((time.perf_counter() - started) * 1000)
            return HealthResult(False, exc.code, f"HTTP {exc.code}", latency)
        except (OSError, ValueError, socket.timeout) as exc:
            return HealthResult(False, error=str(exc) or exc.__class__.__name__)
