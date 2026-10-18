from __future__ import annotations
from PySide6.QtCore import Signal
from PySide6.QtWidgets import (QCheckBox, QFormLayout, QGroupBox, QHBoxLayout, QLabel, QLineEdit, QListWidget,
    QPushButton, QPlainTextEdit, QSpinBox, QComboBox, QVBoxLayout, QWidget, QFileDialog, QTableWidget, QTableWidgetItem)

PAGES = ["Dashboard", "Server Control", "Video Storage", "Database", "Logs", "Backups", "Network", "Updates", "Startup", "Diagnostics", "Settings / About"]

class Page(QWidget):
    action = Signal(str, object)
    def __init__(self, name, bridge):
        super().__init__(); self.name, self.bridge = name, bridge
        self.layout = QVBoxLayout(self); self.layout.setContentsMargins(28, 24, 28, 24); self.layout.setSpacing(16)
        title = QLabel(name); title.setObjectName("pageTitle"); self.layout.addWidget(title); self.build()
    def button(self, text, action, payload=None):
        b = QPushButton(text); b.clicked.connect(lambda: self.action.emit(action, payload)); return b
    def build(self): self.layout.addStretch()

class Dashboard(Page):
    def build(self):
        header = QHBoxLayout(); self.status = QLabel("Unknown"); self.status.setObjectName("statusBadge"); header.addWidget(self.status); header.addStretch(); header.addWidget(self.button("Refresh status", "health")); self.layout.addLayout(header)
        self.metrics = QTableWidget(0, 2); self.metrics.setHorizontalHeaderLabels(["Metric", "Value"]); self.metrics.horizontalHeader().setStretchLastSection(True); self.metrics.setEditTriggers(QTableWidget.NoEditTriggers); self.layout.addWidget(self.metrics)
        row = QHBoxLayout(); row.addWidget(self.button("Start server", "start")); row.addWidget(self.button("Stop server", "stop")); row.addWidget(self.button("Restart", "restart")); row.addWidget(self.button("Open in browser", "open_browser")); self.layout.addLayout(row)
    def set_health(self, data):
        self.status.setText(str(data.get("status", "unknown")).upper()); self.metrics.setRowCount(0)
        values = [("Repository", data.get("repo", "—")), ("PID", data.get("pid", "—")), ("Health", data.get("health", {}).get("status_code", data.get("health", {}).get("error", "—"))), ("Free disk", data.get("disk_free", "—"))]
        for key, value in values:
            row = self.metrics.rowCount(); self.metrics.insertRow(row); self.metrics.setItem(row, 0, QTableWidgetItem(key)); self.metrics.setItem(row, 1, QTableWidgetItem(str(value)))

class ServerControl(Page):
    def build(self):
        row = QHBoxLayout(); [row.addWidget(self.button(text, action)) for text, action in (("Start", "start"), ("Stop", "stop"), ("Restart", "restart"), ("Refresh", "health"))]; self.layout.addLayout(row)
        self.output = QPlainTextEdit(); self.output.setReadOnly(True); self.output.setMaximumBlockCount(500); self.output.setPlaceholderText("Live server output"); self.layout.addWidget(self.output)
    def show_result(self, data): self.output.appendPlainText(str(data))

class PathPage(Page):
    def __init__(self, name, bridge): self.initial = str(bridge.paths.storage_dir if name == "Video Storage" else bridge.paths.database); super().__init__(name, bridge)
    def build(self):
        box = QGroupBox("Effective location"); form = QFormLayout(box); self.path = QLineEdit(self.initial); browse = QPushButton("Browse…"); browse.clicked.connect(self.browse); line = QHBoxLayout(); line.addWidget(self.path); line.addWidget(browse); form.addRow("Path", line); self.layout.addWidget(box)
        self.info = QLabel("Validate the location before applying it."); self.layout.addWidget(self.info); row = QHBoxLayout(); row.addWidget(self.button("Validate", "validate_path", self.name)); row.addWidget(self.button("Apply and restart", "apply_path", self.name)); row.addWidget(self.button("Open in Explorer", "open_path", self.name)); self.layout.addLayout(row); self.layout.addStretch()
    def browse(self):
        if self.name == "Database":
            selected, _ = QFileDialog.getSaveFileName(self, "Choose database file", self.path.text(), "SQLite (*.sqlite *.db);;All files (*)")
        else:
            selected = QFileDialog.getExistingDirectory(self, "Choose folder", self.path.text())
        if selected: self.path.setText(selected)

class LogsPage(Page):
    def build(self):
        row = QHBoxLayout(); self.search = QLineEdit(); self.search.setPlaceholderText("Filter logs…"); row.addWidget(self.search); row.addWidget(self.button("Refresh", "logs")); self.layout.addLayout(row); self.logs = QPlainTextEdit(); self.logs.setReadOnly(True); self.logs.setMaximumBlockCount(500); self.layout.addWidget(self.logs)
    def append(self, text): self.logs.setPlainText(text)

class BackupsPage(Page):
    def build(self):
        self.media = QCheckBox("Include video media (can be very large)"); self.layout.addWidget(self.media); row = QHBoxLayout(); row.addWidget(self.button("Create backup", "backup")); row.addWidget(self.button("Restore backup…", "restore")); self.layout.addLayout(row); self.info = QLabel("Backups are written atomically with a manifest and a recovery snapshot."); self.layout.addWidget(self.info); self.layout.addStretch()

class NetworkPage(Page):
    def build(self): self.layout.addWidget(QLabel("Configured health endpoint and listening port are read from manager settings.")); self.info = QPlainTextEdit(); self.info.setReadOnly(True); self.layout.addWidget(self.info); self.layout.addWidget(self.button("Run connectivity check", "health"));

class UpdatesPage(Page):
    def build(self): self.info = QPlainTextEdit(); self.info.setReadOnly(True); self.layout.addWidget(self.info); self.layout.addWidget(self.button("Inspect repository state", "update_status"));

class StartupPage(Page):
    def build(self):
        self.server = QCheckBox("Launch the 20Negar server at user logon"); self.gui = QCheckBox("Launch manager at user logon"); self.layout.addWidget(self.server); self.layout.addWidget(self.gui); self.layout.addWidget(self.button("Apply startup settings", "startup")); self.layout.addStretch()

class DiagnosticsPage(Page):
    def build(self): self.output = QPlainTextEdit(); self.output.setReadOnly(True); self.layout.addWidget(self.output); self.layout.addWidget(self.button("Collect diagnostics", "diagnostics")); self.layout.addWidget(self.button("Export JSON…", "diagnostics_export"));

class SettingsPage(Page):
    def build(self):
        box = QGroupBox("Server settings"); form = QFormLayout(box); self.port = QSpinBox(); self.port.setRange(1, 65535); self.port.setValue(int(self.bridge.settings.get("port", 3000))); self.mode = QComboBox(); self.mode.addItems(["development", "production"]); self.mode.setCurrentText(self.bridge.settings.get("mode", "development")); form.addRow("Port", self.port); form.addRow("Mode", self.mode); self.layout.addWidget(box); row = QHBoxLayout(); row.addWidget(self.button("Save settings", "save_settings")); row.addWidget(self.button("Toggle dark/light", "theme")); self.layout.addLayout(row); self.layout.addWidget(QLabel("20Negar Server Manager · configuration is stored under the user application data directory.")); self.layout.addStretch()
