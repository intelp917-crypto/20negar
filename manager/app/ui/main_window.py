from __future__ import annotations
import json, webbrowser, os
from pathlib import Path
from PySide6.QtCore import QThreadPool, Qt
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QListWidget, QMainWindow, QMessageBox, QFileDialog, QProgressDialog, QStackedWidget, QStatusBar, QVBoxLayout, QWidget
from .pages import PAGES, GROUPS, Page, Dashboard, ServerControl, PathPage, LogsPage, BackupsPage, NetworkPage, UpdatesPage, StartupPage, DiagnosticsPage, SettingsPage, PathWizard
from .theme import apply_theme
from ..core.bridge import CoreBridge
from ..workers.tasks import Worker

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__(); self.setWindowTitle("20Negar  /  Server Manager"); self.setMinimumSize(1120, 700); self.resize(1380, 860); self.bridge = CoreBridge(); self.pool = QThreadPool.globalInstance(); self._workers = set(); self.dark = True; self.pages = []; self.page_by_name = {}
        shell = QWidget(); layout = QHBoxLayout(shell); layout.setContentsMargins(0, 0, 0, 0); layout.setSpacing(0); layout.addWidget(self.sidebar()); content = QVBoxLayout(); content.setContentsMargins(0, 0, 0, 0); content.addWidget(self.topbar()); self.stack = QStackedWidget(); content.addWidget(self.stack, 1); layout.addLayout(content, 1); self.setCentralWidget(shell); self.setStatusBar(QStatusBar()); apply_theme(self, True)
        classes = {"Dashboard": Dashboard, "Server Control": ServerControl, "Video Storage": PathPage, "Database": PathPage, "Logs": LogsPage, "Backups": BackupsPage, "Network": NetworkPage, "Updates": UpdatesPage, "Startup": StartupPage, "Diagnostics": DiagnosticsPage, "Settings / About": SettingsPage}
        for name in PAGES:
            page = classes[name](name, self.bridge); page.action.connect(self.handle); self.pages.append(page); self.page_by_name[name] = page; self.stack.addWidget(page)
        self.nav.currentRowChanged.connect(self.stack.setCurrentIndex); self.nav.setCurrentRow(0); self.handle("health", None)
    def sidebar(self):
        frame = QFrame(); frame.setMinimumWidth(235); frame.setMaximumWidth(270); lay = QVBoxLayout(frame); lay.setContentsMargins(14, 20, 14, 14); brand = QLabel("◈  20NEGAR"); brand.setStyleSheet("font-size: 18px; font-weight: 800; padding: 4px 10px 22px;"); lay.addWidget(brand); self.nav = QListWidget(); self.nav.setObjectName("sidebar"); self.nav.setSpacing(1); labels = []
        for group, items in GROUPS.items():
            head = QLabel(group); head.setObjectName("muted"); head.setStyleSheet("font-size: 10px; font-weight: 700; letter-spacing: 1px; padding: 14px 13px 5px;"); lay.addWidget(head)
            for item in items: labels.append(item); self.nav.addItem({"Dashboard": "⌂  Dashboard", "Server Control": "▶  Server Control", "Video Storage": "▣  Video Storage", "Database": "▤  Database", "Logs": "≡  Logs", "Backups": "◫  Backups", "Network": "⌁  Network", "Updates": "↻  Updates", "Startup": "◷  Startup", "Diagnostics": "⌁  Diagnostics", "Settings / About": "⚙  Settings / About"}[item])
        self._nav_labels = labels; lay.addWidget(self.nav, 1); foot = QLabel("LOCAL INSTANCE\nReady for management"); foot.setObjectName("muted"); foot.setStyleSheet("padding: 12px;"); lay.addWidget(foot); return frame
    def topbar(self):
        frame = QFrame(); frame.setStyleSheet("QFrame { border-bottom: 1px solid palette(mid); }"); lay = QHBoxLayout(frame); lay.setContentsMargins(28, 15, 28, 15); title = QLabel("Operations console"); title.setStyleSheet("font-size: 16px; font-weight: 700;"); lay.addWidget(title); lay.addStretch(); status = QLabel("●  Local mode  ·  Connected"); status.setStyleSheet("color: #31c48d; font-weight: 600;"); lay.addWidget(status); return frame
    def run(self, fn, done):
        worker = Worker(fn); self._workers.add(worker); worker.signals.result.connect(done); worker.signals.error.connect(lambda e: self.statusBar().showMessage(str(e), 7000)); worker.signals.finished.connect(lambda: self._workers.discard(worker)); self.pool.start(worker)
    def handle(self, action, payload):
        if action in {"start", "stop", "restart"}: self.run(lambda: self.bridge.service_action(action), self.result)
        elif action == "health": self.run(self.bridge.metrics, self.health)
        elif action == "theme": self.dark = not self.dark; apply_theme(self, self.dark)
        elif action == "logs": self.run(self.bridge.recent_logs, lambda lines: self.page_by_name["Logs"].append("\n".join(lines)))
        elif action == "open_browser": webbrowser.open(self.bridge.settings["health_url"].replace("/api/health", "/"))
        elif action == "path_wizard": self.open_wizard(payload)
        elif action == "open_path": self._open_path(payload)
        elif action == "backup": self.run(lambda: self.bridge.create_backup(self.page_by_name["Backups"].media.isChecked()), self.result)
        elif action == "restore": self._restore()
        elif action == "startup": self.run(lambda: self.bridge.startup(self.page_by_name["Startup"].gui.isChecked(), self.page_by_name["Startup"].server.isChecked()), self.result)
        elif action == "diagnostics": self.run(self.bridge.diagnostics, lambda data: self.page_by_name["Diagnostics"].output.setPlainText(json.dumps(data, ensure_ascii=False, indent=2)))
        elif action == "update_status": self.run(self.bridge.update_status, lambda data: self.page_by_name["Updates"].info.setPlainText(json.dumps(data, ensure_ascii=False, indent=2)))
        elif action == "diagnostics_export":
            target, _ = QFileDialog.getSaveFileName(self, "Export diagnostics", "20negar-diagnostics.json", "JSON (*.json)"); target and self.run(lambda: self.bridge.export_diagnostics(Path(target)), self.result)
        elif action == "save_settings": self.run(lambda: self.bridge.save_settings({"port": self.page_by_name["Settings / About"].port.value(), "mode": self.page_by_name["Settings / About"].mode.currentText()}), self.result)
    def open_wizard(self, kind):
        page = self.page_by_name[kind]; wizard = PathWizard(self, self.bridge, kind, page.initial); wizard.confirmed.connect(self.apply_path); wizard.exec()
    def apply_path(self, kind, value, migrate):
        self.statusBar().showMessage("Applying destination…", 3000); self.path_progress = QProgressDialog("Applying destination and updating configuration…", "Hide", 0, 0, self); self.path_progress.setWindowTitle("Updating storage"); self.path_progress.setMinimumWidth(420); self.path_progress.setWindowModality(Qt.WindowModal); self.path_progress.show()
        fn = lambda: (self.bridge.migrate_storage_path(value) if migrate else self.bridge.set_storage_path(value)) if kind == "Video Storage" else self.bridge.set_database_path(value)
        self.run(fn, lambda data: self._path_result(data, migrate))
    def _path_result(self, data, migrate):
        if hasattr(self, "path_progress"): self.path_progress.close()
        self.result(data)
    def _open_path(self, name):
        try: os.startfile(self.page_by_name[name].initial)
        except (AttributeError, OSError) as exc: self.statusBar().showMessage(str(exc), 5000)
    def _restore(self):
        archive, _ = QFileDialog.getOpenFileName(self, "Choose backup", str(self.bridge.paths.backups_dir), "ZIP (*.zip)"); archive and QMessageBox.question(self, "Confirm restore", "Create a recovery snapshot and restore this backup?") == QMessageBox.Yes and self.run(lambda: self.bridge.restore_backup(Path(archive)), self.result)
    def result(self, data): self.statusBar().showMessage(json.dumps(data, ensure_ascii=False), 8000); self.page_by_name["Server Control"].show_result(data)
    def health(self, data): self.page_by_name["Dashboard"].set_health(data); self.statusBar().showMessage(str(data.get("status", "unknown")), 3000)
    def closeEvent(self, event):
        self.pool.waitForDone(3000)
        self._workers.clear()
        event.accept()
