from dataclasses import dataclass
import socket
import urllib.request

@dataclass
class HealthResult:
    healthy: bool
    status: int | None = None
    error: str | None = None

class HealthMonitor:
    def check(self, url: str, timeout: float = 2.0) -> HealthResult:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return HealthResult(200 <= response.status < 400, response.status)
        except (OSError, ValueError, socket.timeout) as exc:
            return HealthResult(False, error=str(exc))
