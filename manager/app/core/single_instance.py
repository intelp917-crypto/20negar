"""One manager per user session.

Two managers would each own a server process, fight over the health probe and
write the same settings file. The second launch therefore hands over to the
running window and exits instead of opening another UI:

* the first process listens on a per-user local socket (a named pipe on Windows),
* every later launch connects, pokes it so the window comes to the front, and quits.
"""
from __future__ import annotations

import getpass
import hashlib

from PySide6.QtCore import QObject, Signal
from PySide6.QtNetwork import QLocalServer, QLocalSocket


def default_name() -> str:
    """One guard per Windows user, never a machine-wide collision between users."""
    try:
        user = getpass.getuser()
    except (OSError, KeyError):
        user = "default"
    digest = hashlib.sha1(user.encode("utf-8", "replace")).hexdigest()[:12]
    return f"20negar-manager-{digest}"


class SingleInstance(QObject):
    activated = Signal()

    def __init__(self, name: str | None = None, parent=None):
        super().__init__(parent)
        self.name = name or default_name()
        self._server = QLocalServer(self)
        self._server.newConnection.connect(self._accept)

    def acquire(self, timeout_ms: int = 400) -> bool:
        """Return True when this process owns the session; False means hand over."""
        probe = QLocalSocket()
        probe.connectToServer(self.name)
        if probe.waitForConnected(timeout_ms):
            probe.write(b"activate")
            probe.flush()
            probe.waitForBytesWritten(timeout_ms)
            probe.disconnectFromServer()
            return False
        # A crashed instance can leave the socket name behind (Unix only, but
        # removing it is harmless on Windows named pipes).
        QLocalServer.removeServer(self.name)
        return self._server.listen(self.name)

    def _accept(self) -> None:
        while self._server.hasPendingConnections():
            socket = self._server.nextPendingConnection()
            if socket is None:
                continue
            socket.readyRead.connect(lambda s=socket: s.readAll())
            socket.disconnected.connect(socket.deleteLater)
            self.activated.emit()

    def release(self) -> None:
        self._server.close()
        QLocalServer.removeServer(self.name)
