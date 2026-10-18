from __future__ import annotations

import os
import shutil
from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFileDialog,
    QFormLayout, QFrame, QGridLayout, QGroupBox, QHBoxLayout, QLabel, QLineEdit, QListWidget,
    QPlainTextEdit, QProgressBar, QPushButton, QRadioButton, QSpinBox, QStackedWidget,
    QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget)

PAGES = ["Dashboard", "Server Control", "Video Storage", "Database", "Logs", "Backups", "Network", "Updates", "Startup", "Diagnostics", "Settings / About"]
GROUPS = {"OVERVIEW": ["Dashboard"], "OPERATIONS": ["Server Control", "Video Storage", "Database", "Logs", "Backups"], "SYSTEM": ["Network", "Updates", "Startup", "Diagnostics", "Settings / About"]}


def card() -> QFrame:
    frame = QFrame(); frame.setObjectName("card"); frame.setFrameShape(QFrame.StyledPanel); return frame


class Page(QWidget):
    action = Signal(str, object)
    def __init__(self, name, bridge):
        super().__init__(); self.name, self.bridge = name, bridge
        self.layout = QVBoxLayout(self); self.layout.setContentsMargins(34, 28, 34, 28); self.layout.setSpacing(18)
        title = QLabel(name); title.setObjectName("pageTitle"); self.layout.addWidget(title)
        subtitle = QLabel(self.subtitle()); subtitle.setObjectName("pageSubtitle"); self.layout.addWidget(subtitle); self.build()
    def subtitle(self): return {"Dashboard": "A real-time overview of your 20Negar instance.", "Server Control": "Control the server lifecycle and inspect live output.", "Video Storage": "Choose where uploaded media is stored.", "Database": "Manage the SQLite database location.", "Logs": "Review recent output from the running service."}.get(self.name, "Configure and monitor this part of your installation.")
    def button(self, text, action, payload=None, primary=False):
        b = QPushButton(text); b.setObjectName("primary" if primary else ""); b.clicked.connect(lambda: self.action.emit(action, payload)); return b
    def build(self): self.layout.addStretch()


class Dashboard(Page):
    def build(self):
        header = QHBoxLayout(); self.status = QLabel("●  UNKNOWN"); self.status.setObjectName("statusBadge"); header.addWidget(self.status); header.addStretch(); header.addWidget(self.button("↻  Refresh", "health", primary=True)); self.layout.addLayout(header)
        self.metrics = QGridLayout(); self.metric_labels = []
        for i, (label, value) in enumerate((("SERVICE STATUS", "Unknown"), ("PROCESS ID", "—"), ("DISK FREE", "—"), ("REPOSITORY", "—"))):
            box = card(); lay = QVBoxLayout(box); lay.setContentsMargins(17, 14, 17, 14); cap = QLabel(label); cap.setObjectName("muted"); val = QLabel(value); val.setStyleSheet("font-size: 21px; font-weight: 700;"); lay.addWidget(cap); lay.addWidget(val); self.metric_labels.append(val); self.metrics.addWidget(box, 0, i)
        self.layout.addLayout(self.metrics); controls = card(); row = QHBoxLayout(controls); row.addWidget(QLabel("Quick actions")); row.addStretch(); row.addWidget(self.button("Start", "start", primary=True)); row.addWidget(self.button("Stop", "stop")); row.addWidget(self.button("Restart", "restart")); row.addWidget(self.button("Open browser", "open_browser")); self.layout.addWidget(controls); self.layout.addStretch()
    def set_health(self, data):
        health = data.get("health", {}); status = str(data.get("status", "unknown")); self.status.setText(f"●  {status.upper()}"); vals = [status, str(data.get("pid", "—")), self._size(data.get("disk_free")), Path(str(data.get("repo", "—"))).name or "—"]
        for label, value in zip(self.metric_labels, vals): label.setText(value)
    @staticmethod
    def _size(value):
        if not isinstance(value, (int, float)): return str(value or "—")
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if value < 1024: return f"{value:.1f} {unit}"
            value /= 1024
        return f"{value:.1f} PB"


class ServerControl(Page):
    def build(self):
        row = QHBoxLayout(); [row.addWidget(self.button(text, action, primary=action == "start")) for text, action in (("Start server", "start"), ("Stop", "stop"), ("Restart", "restart"), ("Refresh", "health"))]; self.layout.addLayout(row); box = card(); lay = QVBoxLayout(box); lay.addWidget(QLabel("Live server output")); self.output = QPlainTextEdit(); self.output.setReadOnly(True); self.output.setMaximumBlockCount(500); self.output.setPlaceholderText("Output will appear here when the server is running."); lay.addWidget(self.output); self.layout.addWidget(box)
    def show_result(self, data): self.output.appendPlainText(str(data))


class PathWizard(QDialog):
    confirmed = Signal(str, str, bool)
    def __init__(self, parent, bridge, kind, current):
        super().__init__(parent); self.kind, self.current = kind, current; self.setWindowTitle(f"Configure {kind.lower()} destination"); self.setMinimumSize(650, 480); self.stack = QStackedWidget(); self.path = QLineEdit(current); self.migrate = QRadioButton("Migrate existing media to the new destination"); self.change = QRadioButton("Change destination only"); self.change.setChecked(True); self.validation = QLabel("Not validated yet."); self.progress = QProgressBar(); self.progress.setVisible(False)
        self._build_type(); self._build_location(); self._build_review()
        buttons = QDialogButtonBox(QDialogButtonBox.Cancel)
        self.back_button = buttons.addButton("Back", QDialogButtonBox.ButtonRole.ActionRole)
        self.next_button = buttons.addButton("Next", QDialogButtonBox.ButtonRole.AcceptRole)
        self.buttons = buttons
        self.back_button.clicked.connect(lambda: self.stack.setCurrentIndex(max(0, self.stack.currentIndex()-1)))
        self.next_button.clicked.connect(self.next)
        buttons.rejected.connect(self.reject)
        layout = QVBoxLayout(self); layout.addWidget(self.stack); layout.addWidget(self.progress); layout.addWidget(buttons); self._sync_buttons()
    def page(self, title, text):
        w = QWidget(); l = QVBoxLayout(w); h = QLabel(title); h.setObjectName("sectionTitle"); l.addWidget(h); d = QLabel(text); d.setObjectName("muted"); d.setWordWrap(True); l.addWidget(d); self.stack.addWidget(w); return l
    def _build_type(self):
        l = self.page("Destination type", "Choose which location you want to configure."); l.addWidget(QLabel(f"Current {self.kind.lower()} location")); l.addWidget(QLabel(self.current)); l.addStretch()
    def _build_location(self):
        l = self.page("New destination", "The destination is checked for access and available disk space before any changes are made."); row = QHBoxLayout(); row.addWidget(self.path); b = QPushButton("Browse…"); b.clicked.connect(self.browse); row.addWidget(b); l.addLayout(row); l.addWidget(self.validation)
        if self.kind == "Video Storage": l.addWidget(self.change); l.addWidget(self.migrate)
        else: l.addWidget(QLabel("Database changes create a recovery backup automatically."))
        l.addStretch()
    def _build_review(self):
        l = self.page("Review changes", "Confirm the consequences before applying the new destination."); self.review = QLabel(); self.review.setWordWrap(True); l.addWidget(self.review); l.addStretch()
    def browse(self):
        selected = QFileDialog.getExistingDirectory(self, "Choose destination", self.path.text()) if self.kind == "Video Storage" else QFileDialog.getSaveFileName(self, "Choose database file", self.path.text(), "SQLite (*.sqlite *.db);;All files (*)")[0]
        if selected: self.path.setText(selected)
    def validate(self):
        target = Path(self.path.text()).expanduser(); parent = target if self.kind == "Video Storage" else target.parent
        try:
            parent.mkdir(parents=True, exist_ok=True); free = shutil.disk_usage(parent).free; writable = os.access(parent, os.W_OK); self.validation.setText(f"✓ Access verified  ·  {free / (1024**3):.1f} GB free" if writable else "✕ Destination is not writable")
            return writable
        except OSError as exc: self.validation.setText(f"✕ Validation failed: {exc}"); return False
    def next(self):
        if self.stack.currentIndex() == 0: self.stack.setCurrentIndex(1)
        elif self.stack.currentIndex() == 1:
            if not self.validate(): return
            mode = "Migrate existing media" if self.migrate.isChecked() else "Change destination only"; self.review.setText(f"<b>Current:</b> {self.current}<br><b>New:</b> {self.path.text()}<br><br><b>Operation:</b> {mode}<br><br>The server will require a restart. Review the path carefully, then choose Apply."); self.stack.setCurrentIndex(2); self.next_button.setText("Apply")
        else: self.confirmed.emit(self.kind, self.path.text(), self.migrate.isChecked()); self.accept()
        self._sync_buttons()
    def _sync_buttons(self): self.back_button.setEnabled(self.stack.currentIndex() > 0); self.next_button.setText("Apply" if self.stack.currentIndex() == 2 else "Next")


class PathPage(Page):
    def __init__(self, name, bridge): self.initial = str(bridge.paths.storage_dir if name == "Video Storage" else bridge.paths.database); super().__init__(name, bridge)
    def build(self):
        box = card(); form = QFormLayout(box); form.addRow("Current location", QLabel(self.initial)); self.info = QLabel("Use the guided setup to validate access, preview impact, and confirm changes."); self.info.setObjectName("muted"); self.layout.addWidget(box); self.layout.addWidget(self.info); row = QHBoxLayout(); row.addWidget(self.button("Open guided setup", "path_wizard", self.name, primary=True)); row.addWidget(self.button("Open in Explorer", "open_path", self.name)); self.layout.addLayout(row); self.layout.addStretch()


class LogsPage(Page):
    def build(self):
        row = QHBoxLayout(); self.search = QLineEdit(); self.search.setPlaceholderText("Filter logs…"); row.addWidget(self.search); row.addWidget(self.button("Refresh", "logs", primary=True)); self.layout.addLayout(row); self.logs = QPlainTextEdit(); self.logs.setReadOnly(True); self.logs.setMaximumBlockCount(500); self.layout.addWidget(self.logs)
    def append(self, text): self.logs.setPlainText(text)
class BackupsPage(Page):
    def build(self):
        box = card(); l = QVBoxLayout(box); self.media = QCheckBox("Include video media (can be very large)"); l.addWidget(self.media); l.addWidget(QLabel("Backups are written atomically with a manifest and a recovery snapshot.")); self.layout.addWidget(box); row = QHBoxLayout(); row.addWidget(self.button("Create backup", "backup", primary=True)); row.addWidget(self.button("Restore backup…", "restore")); self.layout.addLayout(row); self.layout.addStretch()
class NetworkPage(Page):
    def build(self): self.info = QPlainTextEdit(); self.info.setReadOnly(True); self.info.setPlaceholderText("Health endpoint configuration"); self.layout.addWidget(self.info); self.layout.addWidget(self.button("Run connectivity check", "health", primary=True))
class UpdatesPage(Page):
    def build(self): self.info = QPlainTextEdit(); self.info.setReadOnly(True); self.layout.addWidget(self.info); self.layout.addWidget(self.button("Inspect repository state", "update_status", primary=True))
class StartupPage(Page):
    def build(self):
        self.server = QCheckBox("Launch the 20Negar server at user logon")
        self.gui = QCheckBox("Launch manager at user logon")
        status = self.bridge.startup_status()
        self.server.setChecked(bool(status["server"]))
        self.gui.setChecked(bool(status["manager"]))
        self.layout.addWidget(self.server); self.layout.addWidget(self.gui)
        self.layout.addWidget(QLabel(f"Startup folder: {status['directory']}"))
        self.layout.addWidget(self.button("Apply startup settings", "startup", primary=True)); self.layout.addStretch()
class DiagnosticsPage(Page):
    def build(self): self.output = QPlainTextEdit(); self.output.setReadOnly(True); self.layout.addWidget(self.output); row = QHBoxLayout(); row.addWidget(self.button("Collect diagnostics", "diagnostics", primary=True)); row.addWidget(self.button("Export JSON…", "diagnostics_export")); self.layout.addLayout(row)
class SettingsPage(Page):
    def build(self):
        box = QGroupBox("Server settings"); form = QFormLayout(box); self.port = QSpinBox(); self.port.setRange(1, 65535); self.port.setValue(int(self.bridge.settings.get("port", 3000))); self.mode = QComboBox(); self.mode.addItems(["development", "production"]); self.mode.setCurrentText(self.bridge.settings.get("mode", "development")); form.addRow("Port", self.port); form.addRow("Mode", self.mode); self.layout.addWidget(box); row = QHBoxLayout(); row.addWidget(self.button("Save settings", "save_settings", primary=True)); row.addWidget(self.button("Toggle dark / light", "theme")); self.layout.addLayout(row); self.layout.addWidget(QLabel("20Negar Server Manager · configuration is stored under user application data.")); self.layout.addStretch()
