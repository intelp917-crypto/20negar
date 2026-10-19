"""System-tray presence, so the manager keeps running next to the clock."""
from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtWidgets import QMenu, QSystemTrayIcon

from .icons import app_icon


class ManagerTray(QSystemTrayIcon):
    open_requested = Signal()
    settings_requested = Signal()
    toggle_server_requested = Signal()
    restart_requested = Signal()
    exit_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(app_icon(), parent)
        self.setToolTip("20Negar Studio — Server Manager")
        menu = QMenu()
        self.status_action = menu.addAction("Stopped")
        self.status_action.setEnabled(False)
        menu.addSeparator()
        self.open_action = menu.addAction("Open 20Negar Manager")
        self.open_action.triggered.connect(self.open_requested)
        self.toggle_action = menu.addAction("Start server")
        self.toggle_action.triggered.connect(self.toggle_server_requested)
        self.restart_action = menu.addAction("Restart server")
        self.restart_action.triggered.connect(self.restart_requested)
        menu.addSeparator()
        self.settings_action = menu.addAction("Settings…")
        self.settings_action.triggered.connect(self.settings_requested)
        self.exit_action = menu.addAction("Exit manager…")
        self.exit_action.triggered.connect(self.exit_requested)
        self.setContextMenu(menu)
        self._menu = menu
        self.activated.connect(self._on_activated)

    def _on_activated(self, reason) -> None:
        if reason in (QSystemTrayIcon.Trigger, QSystemTrayIcon.DoubleClick):
            self.open_requested.emit()

    def set_state(self, state: dict) -> None:
        phase = state.get("phase", "stopped")
        pid = state.get("pid")
        labels = {
            "running": f"Server running · pid {pid}" if pid else "Server running",
            "external": "Server running (external)",
            "starting": "Server starting…",
            "stopping": "Server stopping…",
            "unhealthy": "Server unhealthy",
            "stopped": "Server stopped",
        }
        self.status_action.setText(labels.get(phase, "Server stopped"))
        stop = phase in {"running", "external", "unhealthy"}
        self.toggle_action.setText("Stop server" if stop else "Start server")
        self.toggle_action.setEnabled(phase not in {"starting", "stopping"})
        self.restart_action.setEnabled(phase not in {"starting", "stopping"})
        self.setToolTip(f"20Negar Studio — {labels.get(phase, 'Server stopped')}")
        self._menu.setToolTipsVisible(True)
