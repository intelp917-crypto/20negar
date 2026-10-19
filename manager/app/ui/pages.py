from __future__ import annotations

import os
import shutil
import socket
import sys
import time
from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QDialog, QFileDialog, QFormLayout, QGridLayout, QHBoxLayout,
    QHeaderView, QLabel, QLineEdit, QScrollArea, QSizePolicy, QSpinBox, QStackedWidget,
    QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget)

from . import theme
from .widgets import (Card, Chip, Console, EmptyState, KeyValue, Meter, PageHeader, PathField,
    Select, StateButton, StatCard, StatusPill, Switch, button, divider, eyebrow, tone_color)

PAGES = ["Dashboard", "Server", "Storage", "Database", "Logs", "Backups",
         "Network", "Updates", "TLS / HTTPS", "Startup", "Diagnostics", "Settings"]

ACTIVE_PHASES = {"running", "external", "unhealthy"}

GROUPS: dict[str, list[tuple[str, str]]] = {
    "OVERVIEW": [("Dashboard", "◈")],
    "OPERATIONS": [("Server", "▶"), ("Storage", "▤"), ("Database", "▦"),
                   ("Logs", "≡"), ("Backups", "◫")],
    "SYSTEM": [("Network", "⌁"), ("Updates", "↻"), ("TLS / HTTPS", "⚿"),
               ("Startup", "◷"), ("Diagnostics", "◎"), ("Settings", "⚙")],
}

SECTION_OF = {name: group.title() for group, items in GROUPS.items() for name, _ in items}

EYEBROWS = {
    "Dashboard": "Live overview", "Server": "Lifecycle", "Storage": "Media files",
    "Database": "SQLite", "Logs": "Stream", "Backups": "Recovery",
    "Network": "Connectivity", "Updates": "Repository", "TLS / HTTPS": "Certificates",
    "Startup": "Sign-in",
    "Diagnostics": "Support", "Settings": "Preferences",
}

HEADERS = {
    "Dashboard": ("Overview", "Dashboard", "A real-time view of your 20Negar studio instance."),
    "Server": ("Operations", "Server", "Start, stop and restart the service, and watch it live."),
    "Storage": ("Operations", "Storage", "Choose where uploaded media and HLS output live."),
    "Database": ("Operations", "Database", "The SQLite file that holds users, videos and audit data."),
    "Logs": ("Operations", "Logs", "Streamed output from the managed Node.js process."),
    "Backups": ("Operations", "Backups", "Atomic ZIP snapshots you can restore at any time."),
    "Network": ("System", "Network", "The health endpoint and the port the studio listens on."),
    "Updates": ("System", "Updates", "Inspect the repository this installation runs from."),
    "TLS / HTTPS": ("System", "TLS / HTTPS",
                    "Serve the studio over HTTPS with a self-signed or Let's Encrypt certificate."),
    "Startup": ("System", "Startup", "Launch the manager and the server automatically at sign-in."),
    "Diagnostics": ("System", "Diagnostics", "Collect environment details for troubleshooting."),
    "Settings": ("System", "Settings", "Preferences for the manager and the managed server."),
}


def human_size(value) -> str:
    try:
        size = float(value)
    except (TypeError, ValueError):
        return "—"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(size) < 1024:
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} PB"


def human_uptime(seconds) -> str:
    try:
        seconds = int(seconds or 0)
    except (TypeError, ValueError):
        return "—"
    if seconds <= 0:
        return "—"
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes, secs = divmod(rest, 60)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    if minutes:
        return f"{minutes}m {secs}s"
    return f"{secs}s"


def same_path(left: str | Path | None, right: str | Path | None) -> bool:
    if not left or not right:
        return False
    try:
        return os.path.normcase(str(Path(left).expanduser().resolve())) == \
            os.path.normcase(str(Path(right).expanduser().resolve()))
    except (OSError, ValueError):
        return False


def lan_addresses() -> list[str]:
    """IPv4 addresses a router can forward to, loopback excluded."""
    addresses: set[str] = set()
    virtual = ("vethernet", "wsl", "hyper-v", "docker", "virtualbox", "vmware", "loopback")
    try:
        import psutil
        for name, entries in psutil.net_if_addrs().items():
            if any(marker in name.lower() for marker in virtual):
                continue
            for entry in entries:
                if entry.family == socket.AF_INET and entry.address \
                        and not entry.address.startswith(("127.", "169.254.")):
                    addresses.add(entry.address)
    except Exception:
        pass
    return sorted(addresses)


def notice(text: str, tone: str = "accent") -> QLabel:
    widget = QLabel(text)
    widget.setWordWrap(True)
    widget.setStyleSheet(
        f"background: {theme.current().surface_alt};"
        f" color: {tone_color(tone)}; border: 1px solid {theme.current().border};"
        f" border-radius: 10px; padding: 10px 12px; font-size: 12px;")
    return widget


class Page(QWidget):
    action = Signal(str, object)
    fill = False

    def __init__(self, name: str, bridge):
        super().__init__()
        self.name, self.bridge = name, bridge
        self.setObjectName("PageBody")
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        inner = QWidget()
        inner.setObjectName("PageBody")
        self.layout = QVBoxLayout(inner)
        self.layout.setContentsMargins(30, 22, 30, 24)
        self.layout.setSpacing(16)
        _section, title, subtitle = HEADERS[name]
        self.header = PageHeader(EYEBROWS.get(name, name), title, subtitle)
        self.layout.addWidget(self.header)
        self.build()
        if not self.fill:
            self.layout.addStretch(1)
        scroll.setWidget(inner)
        outer.addWidget(scroll)

    def subtitle(self) -> str:
        return HEADERS[self.name][2]

    def button(self, text: str, action: str, payload=None, variant: str = "default",
               compact: bool = False):
        widget = button(text, variant, compact=compact)
        widget.clicked.connect(lambda: self.action.emit(action, payload))
        return widget

    def emit(self, action: str, payload=None) -> None:
        self.action.emit(action, payload)

    def build(self) -> None:  # pragma: no cover - overridden
        pass

    def on_state(self, state: dict) -> None:
        pass


def grid(*cards: QWidget, columns: int | None = None) -> QGridLayout:
    layout = QGridLayout()
    layout.setContentsMargins(0, 0, 0, 0)
    layout.setHorizontalSpacing(14)
    layout.setVerticalSpacing(14)
    count = columns or max(1, len(cards))
    for index, card in enumerate(cards):
        # Cards in a row always share the row height, never a ragged bottom edge.
        card.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Expanding)
        layout.addWidget(card, index // count, index % count)
    for column in range(count):
        layout.setColumnStretch(column, 1)
    return layout


# ---------------------------------------------------------------------------
class Dashboard(Page):
    fill = True

    def build(self) -> None:
        hero = Card()
        hero.setObjectName("Hero")
        row = QHBoxLayout()
        row.setContentsMargins(6, 4, 6, 4)
        row.setSpacing(26)
        left = QVBoxLayout()
        left.setSpacing(10)
        self.pill = StatusPill()
        self.headline = QLabel("Server is stopped")
        self.headline.setObjectName("Headline")
        self.endpoint = QLabel(self.bridge.settings.get("health_url", ""))
        self.endpoint.setObjectName("Muted")
        actions = QHBoxLayout()
        actions.setSpacing(8)
        self.state_button = StateButton()
        self.state_button.clicked.connect(self._toggle_server)
        actions.addWidget(self.state_button)
        actions.addWidget(self.button("↗   Open studio", "open_browser", variant="ghost"))
        actions.addWidget(self.button("≡   View logs", "navigate", "Logs", variant="ghost"))
        actions.addStretch(1)
        left.addWidget(self.pill, 0, Qt.AlignLeft)
        left.addWidget(self.headline)
        left.addWidget(self.endpoint)
        left.addLayout(actions)
        row.addLayout(left, 1)

        right = QVBoxLayout()
        right.setSpacing(4)
        caption = eyebrow("Uptime")
        self.uptime = QLabel("—")
        self.uptime.setObjectName("HeroValue")
        self.session = QLabel("not running")
        self.session.setObjectName("Muted")
        right.addWidget(caption)
        right.addWidget(self.uptime)
        right.addWidget(self.session)
        right.addStretch(1)
        row.addLayout(right)
        hero.add_layout(row)
        self.layout.addWidget(hero)

        self.status_card = StatCard("Service", "Stopped", "no managed process")
        self.pid_card = StatCard("Process id", "—", "spawned by this manager")
        self.cpu_card = StatCard("CPU", "—", "server process")
        self.memory_card = StatCard("Memory", "—", "resident set size")
        self.disk_card = StatCard("Disk", "—", "free space")
        self.layout.addLayout(grid(self.status_card, self.pid_card, self.cpu_card,
                                   self.memory_card, self.disk_card))

        bottom = QHBoxLayout()
        bottom.setSpacing(14)
        activity = Card("Recent activity", "The tail of the managed server output.")
        activity.add_action(self.button("Open logs", "navigate", "Logs", variant="ghost", compact=True))
        self.activity = Console("Server output will appear here once it starts.")
        self.activity.setMinimumHeight(130)
        activity.add(self.activity, 1)
        activity.setMinimumWidth(420)
        bottom.addWidget(activity, 3)

        quick = Card("Quick actions", "Common tasks, one click away.")
        quick.setMinimumWidth(250)
        quick.setMaximumWidth(330)
        for text, action, payload in (
            ("↻    Restart server", "restart", None),
            ("◫    Create backup", "backup", None),
            ("◎    Run diagnostics", "diagnostics", None),
            ("⚙    Open settings", "navigate", "Settings"),
        ):
            widget = self.button(text, action, payload, variant="ghost")
            widget.setStyleSheet("text-align: left; padding-left: 12px;")
            quick.add(widget)
        quick.body.addStretch(1)
        bottom.addWidget(quick, 1)
        self.layout.addLayout(bottom, 1)

    def _toggle_server(self) -> None:
        self.emit(self.state_button.action or "start")

    def on_state(self, state: dict) -> None:
        phase = state.get("phase", "stopped")
        self.pill.set_phase(phase)
        self.state_button.set_phase(phase)
        headline = {
            "running": "Server is running", "external": "Server is running",
            "starting": "Server is starting…", "stopping": "Server is stopping…",
            "unhealthy": "Server is not responding", "stopped": "Server is stopped",
        }.get(phase, "Server is stopped")
        self.headline.setText(headline)
        self.endpoint.setText(state.get("health_url") or self.bridge.settings.get("health_url", ""))
        self.uptime.setText(human_uptime(state.get("uptime")) if phase in {"running", "external", "unhealthy"} else "—")
        started = state.get("started_at")
        if phase in {"running", "external", "unhealthy"} and started:
            self.session.setText(f"since {time.strftime('%H:%M:%S', time.localtime(started))}")
        else:
            self.session.setText("not running")

        self.status_card.set({"running": "Healthy", "external": "Healthy",
                              "starting": "Starting", "stopping": "Stopping",
                              "unhealthy": "Unhealthy"}.get(phase, "Stopped"),
                             f"port {state.get('port', '—')}")
        cpu = state.get("cpu_percent")
        self.cpu_card.set(f"{cpu:.0f}%" if isinstance(cpu, (int, float)) else "—",
                          "server process")
        self.cpu_card.set_progress(cpu, "accent" if (cpu or 0) < 80 else "warning")
        memory = state.get("memory_bytes")
        memory_percent = state.get("memory_percent")
        self.memory_card.set(human_size(memory) if memory else "—",
                             f"{memory_percent:.0f}% of system RAM" if memory_percent
                             else "resident set size")
        self.memory_card.set_progress(memory_percent, "accent")
        pid = state.get("pid")
        self.pid_card.set(str(pid) if pid else "—",
                          "unmanaged" if phase == "external" else "spawned by this manager")

        free = state.get("disk_free")
        total = state.get("disk_total")
        if isinstance(free, (int, float)) and isinstance(total, (int, float)) and total:
            used = total - free
            self.disk_card.set(f"{human_size(free)}", f"free of {human_size(total)}")
            self.disk_card.set_progress(used / total * 100,
                                        "danger" if free / total < 0.05 else "accent")
        else:
            self.disk_card.set("—", "volume unavailable")

    def set_logs(self, lines: list[str]) -> None:
        self.activity.set_lines(lines[-8:] or ["No output yet."])


# ---------------------------------------------------------------------------
class ServerPage(Page):
    fill = True

    def build(self) -> None:
        self.state_button = StateButton()
        self.state_button.clicked.connect(lambda: self.emit(self.state_button.action or "start"))
        self.header.add(self.state_button)

        controls = Card()
        row = QHBoxLayout()
        row.setSpacing(10)
        restart = self.button("↻  Restart", "restart")
        force = self.button("Check health", "refresh", variant="ghost")
        open_studio = self.button("Open studio", "open_browser", variant="ghost")
        row.addWidget(restart)
        row.addWidget(force)
        row.addWidget(open_studio)
        row.addStretch(1)
        self.mode_chip = Chip("development")
        row.addWidget(self.mode_chip)
        controls.add_layout(row)
        self.layout.addWidget(controls)

        process = Card("Process", "Details of the Node.js process owned by this manager.")
        self.command = KeyValue("Command", "—")
        self.working_dir = KeyValue("Working directory", "—")
        self.phase = KeyValue("Phase", "—")
        self.pid = KeyValue("PID", "—")
        self.managed = KeyValue("Managed", "—")
        for widget in (self.phase, self.pid, self.command, self.working_dir, self.managed):
            process.add(widget)

        resources = Card("Resources", "Live usage sampled from the process.")
        self.cpu = Meter("CPU")
        self.memory = Meter("Memory")
        resources.body.addStretch(1)
        resources.add(self.cpu)
        resources.add(divider())
        resources.add(self.memory)
        resources.body.addStretch(1)
        row = QHBoxLayout()
        row.setSpacing(14)
        row.addWidget(process, 1)
        row.addWidget(resources, 1)
        self.layout.addLayout(row)

        console = Card("Live output", "Merged stdout and stderr, capped in memory.")
        self.autoscroll = Switch("Auto-scroll")
        self.autoscroll.setChecked(True)
        console.add_action(self.autoscroll)
        console.add_action(self.button("Clear", "clear_console", variant="ghost", compact=True))
        self.filter = QLineEdit()
        self.filter.setPlaceholderText("Filter output…")
        self.filter.setClearButtonEnabled(True)
        self.filter.textChanged.connect(self._render)
        console.add(self.filter)
        self.console = Console("Output appears here when the server is running.")
        self.console.setMinimumHeight(200)
        console.add(self.console, 1)
        self._raw: list[str] = []
        self.layout.addWidget(console, 1)

    def _render(self) -> None:
        needle = self.filter.text().strip().lower()
        lines = [line for line in self._raw if not needle or needle in line.lower()]
        if lines:
            self.console.set_lines(lines)
        else:
            self.console.set_lines(["No matching output." if self._raw else "No output yet."])
        if self.autoscroll.isChecked():
            bar = self.console.verticalScrollBar()
            bar.setValue(bar.maximum())

    def set_logs(self, lines: list[str]) -> None:
        self._raw = list(lines)
        self._render()

    def clear(self) -> None:
        self._raw = []
        self._render()

    def on_state(self, state: dict) -> None:
        phase = state.get("phase", "stopped")
        self.state_button.set_phase(phase)
        self.phase.set({"running": "Running", "external": "Running (external)",
                        "starting": "Starting", "stopping": "Stopping",
                        "unhealthy": "Unhealthy"}.get(phase, "Stopped"))
        self.pid.set(str(state.get("pid") or "—"))
        self.command.set(state.get("cmdline") and " ".join(state["cmdline"]) or "—")
        self.working_dir.set(state.get("repo") or "—")
        self.managed.set("Yes" if state.get("managed") else
                         ("No — started outside the manager" if phase == "external" else "No"))
        self.mode_chip.set_state(str(state.get("mode", "development")), "accent")
        cpu = state.get("cpu_percent")
        self.cpu.set(f"{cpu:.0f}%" if isinstance(cpu, (int, float)) else "—", cpu,
                     "server process" if phase in ACTIVE_PHASES else "idle",
                     "accent" if (cpu or 0) < 80 else "warning")
        memory = state.get("memory_bytes")
        memory_percent = state.get("memory_percent")
        self.memory.set(human_size(memory) if memory else "—", memory_percent,
                        "of system RAM" if memory_percent else "resident set size")


# ---------------------------------------------------------------------------
class StoragePage(Page):
    def build(self) -> None:
        destination = Card("Media destination", "Uploaded videos, thumbnails and HLS output.")
        self.path_field = PathField(str(self.bridge.paths.storage_dir))
        destination.add(self.path_field)
        self.chips = QHBoxLayout()
        self.chips.setSpacing(8)
        self.exists_chip = Chip("checking…")
        self.size_chip = Chip("—")
        self.free_chip = Chip("—")
        for chip in (self.exists_chip, self.size_chip, self.free_chip):
            self.chips.addWidget(chip)
        self.chips.addStretch(1)
        destination.add_layout(self.chips)
        actions = QHBoxLayout()
        actions.setSpacing(8)
        actions.addWidget(self.button("Change destination…", "path_wizard", "storage", variant="primary"))
        actions.addWidget(self.button("Open folder", "open_path", "storage", variant="ghost"))
        actions.addWidget(self.button("Validate access", "validate_storage", variant="ghost"))
        actions.addStretch(1)
        destination.add_layout(actions)
        self.layout.addWidget(destination)

        videos = Card("Videos destination",
                      "Uploaded originals and their renditions. Can live on another drive.")
        self.videos_field = PathField(str(self.bridge.videos_dir))
        videos.add(self.videos_field)
        video_chips = QHBoxLayout()
        video_chips.setSpacing(8)
        self.videos_exist = Chip("checking…")
        self.videos_size = Chip("—")
        video_chips.addWidget(self.videos_exist)
        video_chips.addWidget(self.videos_size)
        video_chips.addStretch(1)
        videos.add_layout(video_chips)
        video_actions = QHBoxLayout()
        video_actions.setSpacing(8)
        video_actions.addWidget(self.button("Change videos folder…", "path_wizard", "videos", variant="primary"))
        video_actions.addWidget(self.button("Open folder", "open_path", "videos", variant="ghost"))
        video_actions.addWidget(self.button("Use storage default", "reset_videos", variant="ghost"))
        video_actions.addStretch(1)
        videos.add_layout(video_actions)
        videos.add(_bullet("Database rows keep the key videos/<file>; only the physical folder changes."))
        videos.add(_bullet("The folder must be outside the media storage root, so a storage move cannot orphan it."))
        self.layout.addWidget(videos)

        runtime = Card("Runtime configuration",
                       "The manager writes these values to .env and passes them to the server.")
        self.env_storage = KeyValue("NEGAR_STORAGE_DIR (.env)", "—")
        self.active_storage = KeyValue("Storage root reported by server", "—")
        self.storage_match = Chip("not verified")
        runtime.add(self.env_storage)
        runtime.add(self.active_storage)
        runtime.add_layout(self._chip_row(self.storage_match))
        self.env_videos = KeyValue("NEGAR_VIDEOS_DIR (.env)", "—")
        self.active_videos = KeyValue("Videos root reported by server", "—")
        self.videos_match = Chip("not verified")
        runtime.add(self.env_videos)
        runtime.add(self.active_videos)
        runtime.add_layout(self._chip_row(self.videos_match))
        runtime.add_action(self.button("Sync config", "sync_env", variant="ghost", compact=True))
        runtime.add_action(self.button("Restart to apply", "restart", compact=True))
        self.layout.addWidget(runtime)

        notes = Card("How migration works")
        for text in (
            "The server is stopped before anything moves, so SQLite and media never change under a live process.",
            "Every copied file is verified by size and SHA-256 checksum before the destination is used.",
            "With migration enabled the previous folder is kept intact until you delete it yourself.",
            "Restarting the server is verified through /api/health and the startup log.",
        ):
            notes.add(_bullet(text))
        self.layout.addWidget(notes)

    @staticmethod
    def _chip_row(chip: Chip) -> QHBoxLayout:
        row = QHBoxLayout()
        row.addWidget(chip)
        row.addStretch(1)
        return row

    def on_state(self, state: dict) -> None:
        path = state.get("storage") or ""
        if path:
            self.path_field.set_path(path)
        exists = Path(path).exists() if path else False
        self.exists_chip.set_state("exists" if exists else "missing",
                                   "success" if exists else "danger")
        self.size_chip.set_state(f"{human_size(state.get('storage_size', 0))} media", "muted")
        free, total = state.get("disk_free"), state.get("disk_total")
        if isinstance(free, (int, float)) and isinstance(total, (int, float)) and total:
            self.free_chip.set_state(f"{human_size(free)} free", "muted")
        env = self.bridge.server_env()
        self.env_storage.set(env.get("NEGAR_STORAGE_DIR") or "not set — server default")
        runtime = state.get("runtime", {})
        active = runtime.get("storage")
        self.active_storage.set(active or "not reported yet")
        if active and path:
            self.storage_match.set_state("synced" if same_path(active, path) else "restart needed",
                                         "success" if same_path(active, path) else "warning")
        else:
            self.storage_match.set_state("not verified", "muted")

        videos = state.get("videos") or ""
        if videos:
            self.videos_field.set_path(videos)
        videos_exists = Path(videos).exists() if videos else False
        self.videos_exist.set_state("exists" if videos_exists else "missing",
                                    "success" if videos_exists else "danger")
        self.videos_size.set_state(f"{human_size(state.get('videos_size', 0))} videos", "muted")
        self.env_videos.set(env.get("NEGAR_VIDEOS_DIR") or "not set — storage/videos")
        active_videos = runtime.get("videos")
        self.active_videos.set(active_videos or "not reported yet")
        if active_videos and videos:
            synced = same_path(active_videos, videos)
            self.videos_match.set_state("synced" if synced else "restart needed",
                                        "success" if synced else "warning")
        else:
            self.videos_match.set_state("not verified", "muted")


# ---------------------------------------------------------------------------
class DatabasePage(Page):
    def build(self) -> None:
        header = Card("Database file", "SQLite database with users, videos, reviews and audit logs.")
        self.path_field = PathField(str(self.bridge.paths.database))
        header.add(self.path_field)
        self.meta = QHBoxLayout()
        self.meta.setSpacing(8)
        self.size_chip = Chip("—", "muted")
        self.integrity = Chip("not checked", "muted")
        self.meta.addWidget(self.size_chip)
        self.meta.addWidget(self.integrity)
        self.meta.addStretch(1)
        header.add_layout(self.meta)
        actions = QHBoxLayout()
        actions.setSpacing(8)
        actions.addWidget(self.button("Change database path…", "path_wizard", "database", variant="primary"))
        actions.addWidget(self.button("Check integrity", "validate_db", variant="ghost"))
        actions.addWidget(self.button("Back up now", "backup", variant="ghost"))
        actions.addWidget(self.button("Open folder", "open_path", "database", variant="ghost"))
        actions.addStretch(1)
        header.add_layout(actions)
        self.layout.addWidget(header)

        runtime = Card("Runtime configuration",
                       "Both the .env file and the spawned process must point at the same file.")
        self.configured = KeyValue("Manager setting", "—")
        self.env_value = KeyValue("NEGAR_DB_FILE_PATH (.env)", "—")
        self.active = KeyValue("Database file reported by server", "—")
        self.match = Chip("not verified", "muted")
        runtime.add(self.configured)
        runtime.add(self.env_value)
        runtime.add(self.active)
        row = QHBoxLayout()
        row.addWidget(self.match)
        row.addStretch(1)
        runtime.add_layout(row)
        runtime.add_action(self.button("Sync config", "sync_env", variant="ghost", compact=True))
        runtime.add_action(self.button("Restart server", "restart", compact=True))
        self.layout.addWidget(runtime)

        safety = Card("Safety")
        for text in (
            "The running server is stopped before the file is copied, so nothing writes to the old location.",
            "A recovery ZIP is created in the backups folder before any database operation.",
            "The copied database must pass PRAGMA integrity_check before the switch is committed.",
            "An existing file at the destination is preserved with a timestamped .replaced- suffix.",
        ):
            safety.add(_bullet(text))
        self.layout.addWidget(safety)

    def on_state(self, state: dict) -> None:
        path = state.get("database") or ""
        if path:
            self.path_field.set_path(path)
        self.size_chip.set_state(human_size(state.get("database_size", 0)), "muted")
        configured = path
        env = self.bridge.server_env()
        self.configured.set(configured or "—")
        self.env_value.set(env.get("NEGAR_DB_FILE_PATH") or "not set — server default")
        active = state.get("runtime", {}).get("database")
        self.active.set(active or "not reported yet")
        if active and configured:
            synced = same_path(active, configured)
            self.match.set_state("synced — server uses this file" if synced else "mismatch — restart needed",
                                 "success" if synced else "warning")
        else:
            self.match.set_state("not verified", "muted")

    def set_validation(self, result: dict) -> None:
        valid = bool(result.get("valid"))
        self.integrity.set_state("integrity ok" if valid else "integrity failed",
                                 "success" if valid else "danger")
        self.size_chip.set_state(human_size(result.get("size", 0)), "muted")


# ---------------------------------------------------------------------------
class LogsPage(Page):
    fill = True

    def build(self) -> None:
        self.header.add(self.button("Refresh", "logs", variant="ghost", compact=True))
        card = Card("Server output", "In-memory tail of the managed process.")
        self.autoscroll = Switch("Auto-scroll")
        self.autoscroll.setChecked(True)
        card.add_action(self.autoscroll)
        card.add_action(self.button("Copy", "copy_logs", variant="ghost", compact=True))
        card.add_action(self.button("Clear", "clear_console", variant="ghost", compact=True))
        self.filter = QLineEdit()
        self.filter.setPlaceholderText("Filter lines by keyword…")
        self.filter.setClearButtonEnabled(True)
        self.filter.textChanged.connect(self._render)
        card.add(self.filter)
        self.console = Console("Start the server to see live output.")
        self.console.setMinimumHeight(360)
        card.add(self.console, 1)
        self.layout.addWidget(card, 1)
        self._raw: list[str] = []

    def _render(self) -> None:
        needle = self.filter.text().strip().lower()
        lines = [line for line in self._raw if not needle or needle in line.lower()]
        self.console.set_lines(lines or ["No output yet."])
        if self.autoscroll.isChecked():
            bar = self.console.verticalScrollBar()
            bar.setValue(bar.maximum())

    def set_logs(self, lines: list[str]) -> None:
        self._raw = list(lines)
        self._render()

    def clear(self) -> None:
        self._raw = []
        self._render()


# ---------------------------------------------------------------------------
class BackupsPage(Page):
    fill = True

    def build(self) -> None:
        self.header.add(self.button("Refresh", "backups_list", variant="ghost", compact=True))
        card = Card("Snapshots", "Stored in the backups folder as verified ZIP archives.")
        include = QHBoxLayout()
        include.setSpacing(10)
        self.media = Switch("Include media files")
        include.addWidget(self.media)
        include.addStretch(1)
        include.addWidget(self.button("Open folder", "open_path", "backups", variant="ghost"))
        include.addWidget(self.button("Restore selected…", "restore", variant="ghost"))
        include.addWidget(self.button("Create backup", "backup", variant="primary"))
        card.add_layout(include)
        self.table = QTableWidget(0, 3)
        self.table.setHorizontalHeaderLabels(["Backup", "Created", "Size"])
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setSelectionMode(QTableWidget.SingleSelection)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setShowGrid(False)
        header = self.table.horizontalHeader()
        header.setStretchLastSection(False)
        header.setSectionResizeMode(0, QHeaderView.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.setMinimumHeight(200)
        card.add(self.table, 1)
        self.empty = EmptyState("◫", "No backups yet", "Create a snapshot before risky changes.")
        card.add(self.empty, 1)
        self.layout.addWidget(card, 1)
        self._rows: list[str] = []

    def set_backups(self, entries: list[dict]) -> None:
        self._rows = [entry["path"] for entry in entries]
        self.table.setRowCount(len(entries))
        for row, entry in enumerate(entries):
            self.table.setItem(row, 0, QTableWidgetItem(entry["name"]))
            stamp = time.strftime("%Y-%m-%d  %H:%M", time.localtime(entry.get("created_at", 0)))
            self.table.setItem(row, 1, QTableWidgetItem(stamp))
            self.table.setItem(row, 2, QTableWidgetItem(human_size(entry.get("size", 0))))
        self.table.setVisible(bool(entries))
        self.empty.setVisible(not entries)

    def selected_path(self) -> str | None:
        rows = self.table.selectionModel().selectedRows() if self.table.selectionModel() else []
        if not rows:
            return None
        index = rows[0].row()
        return self._rows[index] if 0 <= index < len(self._rows) else None


# ---------------------------------------------------------------------------
class NetworkPage(Page):
    def build(self) -> None:
        card = Card("Health endpoint", "The manager probes this URL every few seconds.")
        self.url = PathField(self.bridge.settings.get("health_url", ""))
        card.add(self.url)
        self.chips = QHBoxLayout()
        self.chips.setSpacing(8)
        self.state_chip = Chip("unknown", "muted")
        self.latency_chip = Chip("—", "muted")
        self.port_chip = Chip("port —", "muted")
        for chip in (self.state_chip, self.latency_chip, self.port_chip):
            self.chips.addWidget(chip)
        self.chips.addStretch(1)
        card.add_layout(self.chips)
        actions = QHBoxLayout()
        actions.setSpacing(8)
        actions.addWidget(self.button("Run connectivity check", "probe_network", variant="primary"))
        actions.addWidget(self.button("Open in browser", "open_browser", variant="ghost"))
        actions.addWidget(self.button("Edit settings", "navigate", "Settings", variant="ghost"))
        actions.addStretch(1)
        card.add_layout(actions)
        self.layout.addWidget(card)

        info = Card("Connection", "How the desktop manager reaches the studio.")
        self.mode = KeyValue("Mode", "—")
        self.interface = KeyValue("Bind address", "0.0.0.0 (all interfaces)")
        self.loopback = KeyValue("Local URL", "—")
        self.lan = KeyValue("LAN URLs", "—")
        info.add(self.mode)
        info.add(self.interface)
        info.add(self.loopback)
        info.add(self.lan)
        self.layout.addWidget(info)

        remote = Card("Access from outside",
                      "Forward the main port on the router to one of the LAN URLs above.")
        self.public = KeyValue("Public URL (.env)", "—")
        self.standard = KeyValue("Standard ports", "—")
        remote.add(self.public)
        remote.add(self.standard)
        remote.add(_bullet("Test from mobile data, not from inside the LAN: many routers lack NAT loopback."))
        remote.add(_bullet("If the router WAN address is private or 100.64.0.0/10, the ISP uses CGNAT "
                           "and port forwarding cannot work without a dedicated public IP or a tunnel."))
        remote.add(_bullet("Check the listener with: netstat -ano | findstr :<port> — it must show 0.0.0.0, "
                           "not 127.0.0.1."))
        self.layout.addWidget(remote)

    def on_state(self, state: dict) -> None:
        url = state.get("health_url") or ""
        if url:
            self.url.set_path(url)
        health = state.get("health", {}) or {}
        ok = bool(health.get("ok"))
        self.state_chip.set_state("reachable" if ok else "unreachable", "success" if ok else "danger")
        latency = health.get("latency_ms")
        self.latency_chip.set_state(f"{latency} ms" if latency is not None else "—",
                                    "muted")
        self.port_chip.set_state(f"port {state.get('port', '—')}", "muted")
        self.mode.set(str(state.get("mode", "development")).title())
        self.loopback.set(url.replace("/api/health", "/") or "—")
        port = state.get("port") or self.bridge.settings.get("port", 3000)
        hosts = lan_addresses()
        self.lan.set(", ".join(f"http://{host}:{port}" for host in hosts) or "no LAN address found")
        env = self.bridge.server_env()
        self.public.set(env.get("PUBLIC_URL") or "not set — same-origin access only")
        standard = str(env.get("ENABLE_STANDARD_PORTS", "true")).lower() != "false"
        self.standard.set(f"HTTP {env.get('HTTP_PORT', '80')} / HTTPS {env.get('SECURE_PORT', '443')}"
                          if standard else "disabled")

    def set_probe(self, result: dict) -> None:
        ok = bool(result.get("ok"))
        self.state_chip.set_state("reachable" if ok else "unreachable", "success" if ok else "danger")
        latency = result.get("latency_ms")
        self.latency_chip.set_state(f"{latency} ms" if latency is not None else "—", "muted")


# ---------------------------------------------------------------------------
class UpdatesPage(Page):
    """Manual, manager-owned update from the official GitHub repository."""

    def build(self) -> None:
        self._data: dict = {}
        self.header.add(self.button("↻  Check for updates", "update_check", variant="ghost"))
        self.update_button = self.button("↓  Update now", "update_apply", variant="primary")
        self.update_button.setEnabled(False)
        self.header.add(self.update_button)

        hero = Card()
        hero.setObjectName("Hero")
        row = QHBoxLayout()
        row.setContentsMargins(6, 4, 6, 4)
        row.setSpacing(26)
        left = QVBoxLayout()
        left.setSpacing(8)
        self.state_chip = Chip("not checked", "muted")
        self.headline = QLabel("Check GitHub for a newer version")
        self.headline.setObjectName("Headline")
        self.detail = QLabel("The update is applied by this manager: it stops the server, "
                             "takes a database snapshot, fast-forwards the checkout and "
                             "starts the server again.")
        self.detail.setObjectName("Muted")
        self.detail.setWordWrap(True)
        left.addWidget(self.state_chip, 0, Qt.AlignLeft)
        left.addWidget(self.headline)
        left.addWidget(self.detail)
        row.addLayout(left, 1)

        right = QVBoxLayout()
        right.setSpacing(4)
        caption = eyebrow("Behind")
        self.hero_behind = QLabel("—")
        self.hero_behind.setObjectName("HeroValue")
        self.hero_behind_hint = QLabel("commits")
        self.hero_behind_hint.setObjectName("Muted")
        right.addWidget(caption)
        right.addWidget(self.hero_behind)
        right.addWidget(self.hero_behind_hint)
        right.addStretch(1)
        row.addLayout(right)
        hero.add_layout(row)
        self.layout.addWidget(hero)

        installed = Card("Installed version", "The checkout this manager is running from.")
        self.branch = KeyValue("Branch", "—")
        self.commit = KeyValue("Commit", "—")
        self.subject = KeyValue("Message", "—")
        self.worktree = Chip("unknown", "muted")
        self.repo = KeyValue("Repository root", str(self.bridge.paths.repo_root))
        installed.add(self.branch)
        installed.add(self.commit)
        installed.add(self.subject)
        installed.add_layout(self._chip_row(self.worktree))
        installed.add(divider())
        installed.add(self.repo)

        latest = Card("Latest on GitHub", "Fetched read-only — your files are never touched.")
        self.latest_commit = KeyValue("Commit", "—")
        self.latest_subject = KeyValue("Message", "—")
        self.remote = KeyValue("Source", str(getattr(self.bridge, "update_remote", ""))
                               or "intelp917-crypto/20negar")
        self.files = KeyValue("Changed files", "—")
        self.checked = KeyValue("Last checked", "—")
        self.dependencies = Chip("no dependency changes", "muted")
        latest.add(self.latest_commit)
        latest.add(self.latest_subject)
        latest.add(divider())
        latest.add(self.files)
        latest.add_layout(self._chip_row(self.dependencies))
        latest.add(self.remote)
        latest.add(self.checked)

        self.layout.addLayout(grid(installed, latest))

        notes = Card("What happens when you update")
        for text in (
            "The running server is stopped first, so no file changes under a live process.",
            "A verified ZIP snapshot of the database is written to Backups before anything moves.",
            "Only a fast-forward pull is used: local commits and uncommitted work are never discarded.",
            "npm install runs automatically when package.json or the lockfile changed.",
            "The server is started again and verified through /api/health; the log shows the new config.",
        ):
            notes.add(_bullet(text))
        notes.add_action(self.button("Open backups", "navigate", "Backups", variant="ghost", compact=True))
        self.layout.addWidget(notes)

    @staticmethod
    def _chip_row(chip: Chip) -> QHBoxLayout:
        row = QHBoxLayout()
        row.addWidget(chip)
        row.addStretch(1)
        return row

    def data(self) -> dict:
        return dict(self._data)

    def set_busy(self, busy: bool) -> None:
        self.update_button.setEnabled(bool(self._data.get("can_apply")) and not busy)
        if busy:
            self.state_chip.set_state("working…", "warning")

    def set_check(self, data: dict) -> None:
        self._data = dict(data or {})
        data = self._data
        self.branch.set(data.get("branch") or "—")
        commit = data.get("commit") or ""
        self.commit.set(commit[:10] if commit else "—")
        self.subject.set(data.get("commit_subject") or "—")
        self.latest_commit.set((data.get("remote_commit") or "")[:10] or "—")
        self.latest_subject.set(data.get("remote_subject") or "—")
        self.files.set(str(len(data.get("files_changed") or [])) + " files"
                       if data.get("files_changed") else "none")
        self.checked.set(data.get("checked_at") or "—")
        self.hero_behind.setText(str(data.get("behind") or 0))
        self.hero_behind_hint.setText("commit" if (data.get("behind") or 0) == 1 else "commits")

        dirty = bool(data.get("dirty"))
        self.worktree.set_state(
            f"{len(data.get('dirty_files') or [])} uncommitted change(s)" if dirty else "clean",
            "warning" if dirty else "success")
        self.dependencies.set_state(
            "dependencies changed" if data.get("dependencies_changed") else "no dependency changes",
            "warning" if data.get("dependencies_changed") else "muted")

        if data.get("error"):
            self.state_chip.set_state("check failed", "danger")
            self.headline.setText("Could not check for updates")
            self.detail.setText(str(data.get("error")))
        elif data.get("up_to_date"):
            self.state_chip.set_state("up to date", "success")
            self.headline.setText("You are running the latest version")
            self.detail.setText(f"Branch {data.get('branch', 'main')} matches GitHub exactly.")
        elif data.get("can_apply"):
            self.state_chip.set_state("update available", "accent")
            self.headline.setText("A newer version is ready to install")
            self.detail.setText(str(data.get("message") or ""))
        else:
            self.state_chip.set_state("manual action needed", "warning")
            self.headline.setText("The update needs a manual step")
            self.detail.setText(str(data.get("message") or ""))
        self.update_button.setEnabled(bool(data.get("can_apply")))


class TLSPage(Page):
    """HTTPS certificates: self-signed for LAN, Let's Encrypt for a domain."""

    def build(self) -> None:
        self.header.add(self.button("↻  Refresh", "tls_status", variant="ghost"))

        status = Card("HTTPS certificate",
                      "Installed where server/tls.ts reads it; no manual file copying.")
        self.error_note = QLabel("")
        self.error_note.setWordWrap(True)
        self.error_note.setVisible(False)
        self.error_note.setStyleSheet(
            f"background: {theme.current().surface_alt}; color: {tone_color('warning')};"
            f" border: 1px solid {theme.current().border}; border-radius: 10px;"
            f" padding: 10px 12px; font-size: 12px;")
        status.add(self.error_note)
        chips = QHBoxLayout()
        chips.setSpacing(8)
        self.state_chip = Chip("not checked", "muted")
        self.expiry_chip = Chip("no certificate", "muted")
        self.https_chip = Chip("HTTPS port 443", "muted")
        for chip in (self.state_chip, self.expiry_chip, self.https_chip):
            chips.addWidget(chip)
        chips.addStretch(1)
        status.add_layout(chips)
        self.domain = KeyValue("Domain", "—")
        self.issuer = KeyValue("Issuer", "—")
        self.expires = KeyValue("Valid until", "—")
        self.names = KeyValue("Covered names", "—")
        self.cert_path = KeyValue("Certificate file", "—")
        self.checked = KeyValue("Last check", "—")
        for widget in (self.domain, self.issuer, self.expires, self.names,
                       self.cert_path, self.checked):
            status.add(widget)
        actions = QHBoxLayout()
        actions.setSpacing(8)
        actions.addWidget(self.button("Install self-signed certificate", "tls_self_signed",
                                      variant="ghost"))
        actions.addWidget(self.button("Renew now", "tls_renew", variant="default"))
        actions.addStretch(1)
        status.add_layout(actions)
        self.layout.addWidget(status)

        le = Card("Let's Encrypt",
                  "A free, trusted certificate that renews itself before expiry.")
        form = QFormLayout()
        form.setHorizontalSpacing(24)
        form.setVerticalSpacing(12)
        self.domain_edit = QLineEdit(str(self.bridge.settings.get("tls_domain", "")))
        self.domain_edit.setPlaceholderText("studio.example.com")
        self.email_edit = QLineEdit(str(self.bridge.settings.get("tls_email", "")))
        self.email_edit.setPlaceholderText("admin@example.com")
        for field in (self.domain_edit, self.email_edit):
            field.setMaximumWidth(420)
            field.setClearButtonEnabled(True)
        form.addRow("Domain", self.domain_edit)
        form.addRow("Account email", self.email_edit)
        le.add_layout(form)
        self.staging = Switch("Use the staging endpoint (test certificates, not trusted)")
        self.staging.setChecked(bool(self.bridge.settings.get("tls_staging", False)))
        le.add(divider())
        le.add(self.staging)
        le.add_action(self.button("Get certificate", "tls_issue", variant="primary",
                                  compact=True))
        self.layout.addWidget(le)

        renew = Card("Automatic renewal",
                     "Checked while the manager runs, including from the tray.")
        self.autorenew = Switch("Renew the Let's Encrypt certificate automatically")
        self.autorenew.setChecked(bool(self.bridge.settings.get("tls_autorenew", True)))
        renew.add(self.autorenew)
        days_row = QHBoxLayout()
        days_row.setSpacing(10)
        label = QLabel("Renew when fewer than")
        label.setObjectName("Muted")
        self.days = QSpinBox()
        self.days.setRange(1, 90)
        self.days.setSuffix(" days")
        self.days.setValue(int(self.bridge.settings.get("tls_autorenew_days", 30)))
        self.days.setMaximumWidth(140)
        days_row.addWidget(label)
        days_row.addWidget(self.days)
        days_row.addStretch(1)
        renew.add_layout(days_row)
        self.last_check = KeyValue("Last automatic check", "—")
        renew.add(self.last_check)
        renew.add_action(self.button("Save renewal settings", "tls_save",
                                     variant="ghost", compact=True))
        self.layout.addWidget(renew)

        notes = Card("Before requesting a certificate")
        for text in (
            "Point the domain's DNS A/AAAA record at this server's public IP.",
            "Let's Encrypt validates over HTTP on port 80: enable standard ports and forward 80/443.",
            "The certificate is installed for server/tls.ts and HTTPS is reloaded by a restart.",
            "Port 80 must not be blocked by another service; the manager can answer the challenge "
            "itself only while the studio server is stopped.",
            "Let's Encrypt does not issue certificates for some sanctioned regions; if validation "
            "fails with a connection error, use a self-signed certificate or a commercial CA.",
        ):
            notes.add(_bullet(text))
        self.layout.addWidget(notes)

    def preferences(self) -> dict:
        return {"tls_domain": self.domain_edit.text().strip(),
                "tls_email": self.email_edit.text().strip(),
                "tls_staging": self.staging.isChecked(),
                "tls_autorenew": self.autorenew.isChecked(),
                "tls_autorenew_days": self.days.value()}

    def set_status(self, data: dict) -> None:
        data = data or {}
        unavailable = bool(data.get("feature_unavailable"))
        self.error_note.setVisible(unavailable)
        if unavailable:
            self.error_note.setText(str(data.get("error") or "HTTPS certificates are unavailable."))
        if data.get("error") and not data.get("configured"):
            self.state_chip.set_state("no certificate", "muted")
            self.expiry_chip.set_state("not configured", "muted")
        elif data.get("ok"):
            kind = data.get("kind") or "self-signed"
            self.state_chip.set_state("Let's Encrypt" if kind == "letsencrypt"
                                      else "self-signed",
                                      "success" if kind == "letsencrypt" else "accent")
            days = data.get("days_left")
            if days is None:
                self.expiry_chip.set_state("unknown expiry", "muted")
            elif not data.get("valid", True):
                self.expiry_chip.set_state("expired", "danger")
            elif int(days) <= 14:
                self.expiry_chip.set_state(f"expires in {days} days", "warning")
            else:
                self.expiry_chip.set_state(f"{days} days left", "success")
        self.https_chip.set_state("HTTPS port 443 active" if data.get("https_active", True)
                                  else "HTTPS ports disabled",
                                  "success" if data.get("https_active", True) else "warning")
        self.domain.set(data.get("domain") or "—")
        self.issuer.set(data.get("issuer") or "—")
        expires = data.get("expires_at") or data.get("not_after") or ""
        self.expires.set(expires[:19].replace("T", " ") if expires else "—")
        names = data.get("san") or []
        self.names.set(", ".join(names[:6]) + (" …" if len(names) > 6 else "") if names else "—")
        self.cert_path.set(data.get("cert_path") or "—")
        last = data.get("last_check") or 0
        if last:
            self.checked.set(time.strftime("%Y-%m-%d %H:%M", time.localtime(float(last))))
            self.last_check.set(self.checked.value.text())
        else:
            self.checked.set("not checked yet")
            self.last_check.set("not checked yet")
        if not self.domain_edit.text().strip() and data.get("domain"):
            self.domain_edit.setText(str(data["domain"]))


# ---------------------------------------------------------------------------
class StartupPage(Page):
    def build(self) -> None:
        status = self.bridge.startup_status()
        self._status = status
        card = Card("Sign-in behaviour", "Per-user startup entries — no administrator rights required.")
        self.server = Switch("Start the 20Negar server when I sign in")
        self.server.setChecked(bool(status["server"]))
        self.manager = Switch("Open the manager when I sign in")
        self.manager.setChecked(bool(status["manager"]))
        card.add(self.server)
        card.add(divider())
        card.add(self.manager)
        card.add(KeyValue("Startup folder", status["directory"]))
        card.add(KeyValue("Server entry", status["server_path"]))
        card.add(KeyValue("Server script", status.get("server_script") or "—"))
        card.add(KeyValue("Server working folder", status["repo_root"]))
        card.add(KeyValue("Server log", status["server_log"]))
        self.command = KeyValue("Server command", status.get("server_command") or "—")
        card.add(self.command)
        self.state = Chip("checked on load", "muted")
        row = QHBoxLayout()
        row.addWidget(self.state)
        row.addStretch(1)
        card.add_layout(row)
        actions = QHBoxLayout()
        actions.setSpacing(8)
        actions.addWidget(self.button("Apply startup settings", "startup", variant="primary", compact=True))
        actions.addWidget(self.button("Open startup folder", "open_path", "startup", variant="ghost"))
        actions.addWidget(self.button("Refresh", "refresh", variant="ghost"))
        actions.addStretch(1)
        card.add_layout(actions)
        self.layout.addWidget(card)

        note = Card("Notes")
        note.add(_bullet("The server entry starts the same Node command the manager uses."))
        note.add(_bullet("It runs from the repository root, so server.ts and .env are found at sign-in."))
        note.add(_bullet("Applying rewrites both entries; stale paths from a moved checkout are repaired."))
        note.add(_bullet("At sign-in the entry runs hidden: no cmd or node window is left on screen."))
        note.add(_bullet("Output still goes to the server log, so a failed start can be diagnosed."))
        self.layout.addWidget(note)
        self.on_state({})

    def values(self) -> dict:
        return {"manager": self.manager.isChecked(), "server": self.server.isChecked()}

    def on_state(self, state: dict) -> None:
        if not hasattr(self, "state"):
            return
        try:
            status = self.bridge.startup_status()
        except Exception:  # missing Node or an unreadable Startup folder
            return
        self._status = status
        if not status["server"]:
            self.state.set_state("server entry not installed", "muted")
        elif status.get("server_current"):
            self.state.set_state("server entry is current", "success")
        else:
            self.state.set_state("entry points elsewhere — apply to repair", "warning")
        self.command.set(status.get("server_command") or "—")


# ---------------------------------------------------------------------------
class DiagnosticsPage(Page):
    fill = True

    def build(self) -> None:
        card = Card("Environment report",
                    "Node, npm and git versions, paths, disk space and health — never secrets.")
        actions = QHBoxLayout()
        actions.setSpacing(8)
        actions.addWidget(self.button("Collect diagnostics", "diagnostics", variant="primary"))
        actions.addWidget(self.button("Export JSON…", "diagnostics_export", variant="ghost"))
        actions.addWidget(self.button("Copy", "copy_diagnostics", variant="ghost"))
        actions.addStretch(1)
        card.add_layout(actions)
        self.output = Console("Collect a report to inspect the runtime environment.")
        self.output.setMinimumHeight(360)
        card.add(self.output, 1)
        self.layout.addWidget(card, 1)

    def set_report(self, text: str) -> None:
        self.output.setPlainText(text)


# ---------------------------------------------------------------------------
class SettingsPage(Page):
    def build(self) -> None:
        card = Card("Server", "Changes are written to settings.json and the .env file.")
        form = QFormLayout()
        form.setLabelAlignment(Qt.AlignLeft)
        form.setFormAlignment(Qt.AlignLeft | Qt.AlignTop)
        form.setHorizontalSpacing(24)
        form.setVerticalSpacing(12)
        self.port = QSpinBox()
        self.port.setRange(1, 65535)
        self.port.setValue(int(self.bridge.settings.get("port", 3000)))
        self.mode = Select(["development", "production"],
                           str(self.bridge.settings.get("mode", "development")))
        self.interval = QSpinBox()
        self.interval.setRange(1, 3600)
        self.interval.setValue(int(self.bridge.settings.get("monitor_interval", 5)))
        self.interval.setSuffix(" s")
        self.health_url = QLineEdit(str(self.bridge.settings.get("health_url", "")))
        for field in (self.port, self.mode, self.health_url, self.interval):
            field.setMaximumWidth(420)
        form.addRow("Port", self.port)
        form.addRow("Mode", self.mode)
        form.addRow("Health URL", self.health_url)
        form.addRow("Poll interval", self.interval)
        card.add_layout(form)
        card.add(divider())

        appearance = Card("Appearance", "The manager remembers your choice.")
        self.theme = Select(["Dark", "Light"],
                            "Light" if self.bridge.settings.get("ui_theme") == "light" else "Dark")
        self.theme.changed.connect(lambda value: self.emit("theme_set", value.lower()))
        self.theme.setMaximumWidth(420)
        appearance_form = QFormLayout()
        appearance_form.setHorizontalSpacing(24)
        appearance_form.setVerticalSpacing(12)
        appearance_form.addRow("Theme", self.theme)
        appearance.add_layout(appearance_form)
        self.tray_switch = Switch("Closing the window hides the manager to the tray")
        self.tray_switch.setChecked(bool(self.bridge.settings.get("close_to_tray", True)))
        appearance.add(self.tray_switch)
        self.layout.addWidget(card)
        self.layout.addWidget(appearance)

        actions = QHBoxLayout()
        actions.setSpacing(8)
        actions.addWidget(self.button("Save settings", "save_settings", variant="primary"))
        actions.addWidget(self.button("Reveal configuration", "open_config", variant="ghost"))
        actions.addStretch(1)
        self.layout.addLayout(actions)

        about = Card("About")
        about.add(KeyValue("Application", "20Negar Server Manager"))
        about.add(KeyValue("Repository", str(self.bridge.paths.repo_root)))
        about.add(KeyValue("Settings file", str(self.bridge.store.path)))
        about.add(KeyValue("Runtime", f"Python {sys.version.split()[0]} · Qt desktop"))
        about.add(_bullet("The manager owns the server process, its logs and its configuration."))
        self.layout.addWidget(about)

    def values(self) -> dict:
        return {"port": self.port.value(), "mode": self.mode.current(),
                "health_url": self.health_url.text().strip(),
                "monitor_interval": self.interval.value(),
                "close_to_tray": self.tray_switch.isChecked()}


def _bullet(text: str) -> QLabel:
    widget = QLabel(f"•   {text}")
    widget.setWordWrap(True)
    widget.setObjectName("Muted")
    return widget


# ---------------------------------------------------------------------------
class PathWizard(QDialog):
    """Guided, validated destination change for storage and the database."""

    confirmed = Signal(str, object)

    def __init__(self, parent, bridge, kind: str, current: str):
        super().__init__(parent)
        self.kind, self.bridge, self.current = kind, bridge, current
        self.is_folder = kind in {"storage", "videos"}
        titles = {"storage": "Change storage destination",
                  "videos": "Change videos destination",
                  "database": "Change database file"}
        self.setWindowTitle(titles.get(kind, "Change destination"))
        self.setMinimumSize(660, 540)
        self.setObjectName("Root")
        self.stack = QStackedWidget()
        t = theme.current()
        self.setStyleSheet(f"QDialog#Root {{ background: {t.window}; }}")

        header = QVBoxLayout()
        header.setSpacing(4)
        self.section = eyebrow({"storage": "Storage", "videos": "Videos",
                                "database": "Database"}.get(kind, "Storage"))
        title = QLabel("Choose a new database file" if kind == "database"
                       else "Choose a new videos folder" if kind == "videos"
                       else "Choose a new destination")
        title.setObjectName("PageTitle")
        subtitle = QLabel("Nothing changes until you review and confirm the plan.")
        subtitle.setObjectName("PageSubtitle")
        header.addWidget(self.section)
        header.addWidget(title)
        header.addWidget(subtitle)

        self.steps = QHBoxLayout()
        self.steps.setSpacing(6)
        self._dots = []
        for _ in range(3):
            dot = QLabel()
            dot.setFixedHeight(4)
            dot.setMinimumWidth(52)
            self._dots.append(dot)
            self.steps.addWidget(dot)
        self.steps.addStretch(1)

        self.path = QLineEdit(current)
        self.path.setObjectName("PathField")
        self.path.setCursorPosition(0)
        self.path.textChanged.connect(self._validate)
        browse = button("Browse…", "default")
        browse.clicked.connect(self._browse)
        path_row = QHBoxLayout()
        path_row.setSpacing(8)
        path_row.addWidget(self.path, 1)
        path_row.addWidget(browse)
        self.validation = Chip("not checked", "muted")
        self.space = QLabel("")
        self.space.setObjectName("CardSubtitle")
        self.hint = QLabel("The destination is checked for access and free space first.")
        self.hint.setObjectName("Muted")
        self.hint.setWordWrap(True)

        step_one = QWidget()
        one = QVBoxLayout(step_one)
        one.setContentsMargins(0, 8, 0, 0)
        one.setSpacing(12)
        current_card = Card("Current location")
        current_field = PathField(current)
        current_card.add(current_field)
        one.addWidget(current_card)
        new_card = Card("New destination")
        new_card.add_layout(path_row)
        chips = QHBoxLayout()
        chips.setSpacing(8)
        chips.addWidget(self.validation)
        chips.addWidget(self.space, 1)
        new_card.add_layout(chips)
        new_card.add(self.hint)
        one.addWidget(new_card)
        one.addStretch(1)

        step_two = QWidget()
        two = QVBoxLayout(step_two)
        two.setContentsMargins(0, 8, 0, 0)
        two.setSpacing(12)
        options = Card("How should this be applied?" if self.is_folder
                       else "Which database should be used?")
        if self.is_folder:
            self.copy_media = Switch("Copy existing videos to the new folder" if kind == "videos"
                                     else "Copy existing media to the new destination")
            self.copy_media.setChecked(True)
            options.add(self.copy_media)
            options.add(_bullet("Copies are verified by size and SHA-256 before the switch."))
            options.add(_bullet("The old folder is kept, so nothing is lost if you change your mind."))
        else:
            self.mode = Select(["Replace: copy the current database here",
                                "Adopt: use the database already at this path"])
            options.add(self.mode)
            options.add(_bullet("A recovery ZIP of the current database is always created first."))
            options.add(_bullet("An existing destination file is preserved with a timestamped suffix."))
        two.addWidget(options)
        self.restart = Switch("Restart the server automatically and verify the result")
        self.restart.setChecked(True)
        restart_card = Card("Apply")
        restart_card.add(self.restart)
        restart_card.add(_bullet("The server is stopped while files are moved, then started again."))
        two.addWidget(restart_card)
        two.addStretch(1)

        step_three = QWidget()
        three = QVBoxLayout(step_three)
        three.setContentsMargins(0, 8, 0, 0)
        three.setSpacing(12)
        review = Card("Review")
        self.summary = QLabel()
        self.summary.setWordWrap(True)
        self.summary.setTextFormat(Qt.RichText)
        review.add(self.summary)
        three.addWidget(review)
        self.warning = notice("The server will be restarted to apply this change.", "accent")
        three.addWidget(self.warning)
        three.addStretch(1)

        for widget in (step_one, step_two, step_three):
            self.stack.addWidget(widget)

        footer = QHBoxLayout()
        footer.setSpacing(8)
        self.cancel = button("Cancel", "ghost")
        self.cancel.clicked.connect(self.reject)
        self.back = button("Back", "default")
        self.back.clicked.connect(self._back)
        self.next = button("Continue", "primary")
        self.next.clicked.connect(self._next)
        footer.addWidget(self.cancel)
        footer.addStretch(1)
        footer.addWidget(self.back)
        footer.addWidget(self.next)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(26, 22, 26, 22)
        layout.setSpacing(14)
        layout.addLayout(header)
        layout.addLayout(self.steps)
        layout.addWidget(self.stack, 1)
        layout.addLayout(footer)
        self._validate()
        self._sync()

    # -- helpers ---------------------------------------------------------
    def _resolved(self) -> Path:
        target = Path(os.path.expandvars(self.path.text().strip())).expanduser()
        if self.kind == "database" and target.suffix == "":
            target = target.with_suffix(".sqlite")
        return target

    def _browse(self) -> None:
        start = self.path.text() or self.current
        if self.is_folder:
            label = "Choose videos folder" if self.kind == "videos" else "Choose media destination"
            selected = QFileDialog.getExistingDirectory(self, label, start)
        else:
            selected = QFileDialog.getSaveFileName(
                self, "Choose database file", start, "SQLite database (*.sqlite *.db);;All files (*)")[0]
        if selected:
            self.path.setText(selected)
            self.path.setCursorPosition(0)

    def _validate(self) -> bool:
        text = self.path.text().strip()
        if not text:
            self.validation.set_state("path required", "danger")
            self.space.setText("")
            return False
        try:
            target = self._resolved()
            parent = target if self.is_folder else target.parent
            parent.mkdir(parents=True, exist_ok=True)
            usage = shutil.disk_usage(parent)
            writable = os.access(parent, os.W_OK)
            self.validation.set_state("writable" if writable else "not writable",
                                      "success" if writable else "danger")
            self.space.setText(f"{human_size(usage.free)} free")
            if self.kind == "database" and target.exists():
                self.hint.setText("A file already exists here — you can replace it or adopt it in the next step.")
            else:
                self.hint.setText("The destination is checked for access and free space first.")
            return writable
        except OSError as exc:
            self.validation.set_state("invalid destination", "danger")
            self.space.setText("")
            self.hint.setText(str(exc))
            return False

    def _sync(self) -> None:
        index = self.stack.currentIndex()
        for position, dot in enumerate(self._dots):
            tone = theme.current().accent if position <= index else theme.current().border
            dot.setStyleSheet(f"background: {tone}; border-radius: 2px;")
        self.back.setEnabled(index > 0)
        self.next.setText("Apply change" if index == 2 else "Continue")

    def _back(self) -> None:
        self.stack.setCurrentIndex(max(0, self.stack.currentIndex() - 1))
        self._sync()

    def _next(self) -> None:
        index = self.stack.currentIndex()
        if index == 0:
            if not self._validate():
                return
            self.stack.setCurrentIndex(1)
        elif index == 1:
            self._render_summary()
            self.stack.setCurrentIndex(2)
        else:
            self.confirmed.emit(self.kind, self.options())
            self.accept()
        self._sync()

    def options(self) -> dict:
        target = self._resolved()
        if self.is_folder:
            return {"path": str(target), "migrate": self.copy_media.isChecked(),
                    "restart": self.restart.isChecked()}
        return {"path": str(target), "mode": "replace" if self.mode.index() == 0 else "adopt",
                "restart": self.restart.isChecked()}

    def _render_summary(self) -> None:
        t = theme.current()
        options = self.options()
        current = self.current
        if self.is_folder:
            operation = "Copy existing files, then switch" if options["migrate"] else "Switch destination only"
        else:
            operation = ("Replace with the current database" if options["mode"] == "replace"
                         else "Adopt the database already at the destination")
        restart = "Restart and verify automatically" if options["restart"] else "Restart manually later"
        self.summary.setText(
            f"<div style='color:{t.muted}; font-size:12px'>CURRENT</div>"
            f"<div style='font-family:Consolas,monospace; color:{t.text}'>{current}</div>"
            f"<div style='color:{t.muted}; font-size:12px; margin-top:10px'>NEW</div>"
            f"<div style='font-family:Consolas,monospace; color:{t.text}'>{options['path']}</div>"
            f"<div style='color:{t.muted}; font-size:12px; margin-top:10px'>OPERATION</div>"
            f"<div style='color:{t.text}'>{operation} · {restart}</div>")
        self.warning.setText("The server will be stopped while files are moved, then restarted."
                             if options["restart"] else
                             "The new destination is written to .env and settings; restart the server to use it.")
