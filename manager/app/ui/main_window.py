from __future__ import annotations
import json
import webbrowser
from PySide6.QtCore import QThreadPool
from PySide6.QtWidgets import QMainWindow, QListWidget, QStackedWidget, QSplitter, QStatusBar, QMessageBox, QFileDialog
from .pages import PAGES, Page, Dashboard, ServerControl, PathPage, LogsPage, BackupsPage, NetworkPage, UpdatesPage, StartupPage, DiagnosticsPage, SettingsPage
from .theme import apply_theme
from ..core.bridge import CoreBridge
from ..workers.tasks import Worker

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__(); self.setWindowTitle("20Negar Server Manager"); self.setMinimumSize(980, 640); self.resize(1250, 800); self.bridge = CoreBridge(); self.pool = QThreadPool.globalInstance(); self.dark = True
        self.nav = QListWidget(); self.nav.addItems(PAGES); self.nav.setMinimumWidth(190); self.stack = QStackedWidget(); self.pages = []
        classes = {"Dashboard": Dashboard, "Server Control": ServerControl, "Video Storage": PathPage, "Database": PathPage, "Logs": LogsPage, "Backups": BackupsPage, "Network": NetworkPage, "Updates": UpdatesPage, "Startup": StartupPage, "Diagnostics": DiagnosticsPage, "Settings / About": SettingsPage}
        for name in PAGES:
            page = classes[name](name, self.bridge); page.action.connect(self.handle); self.pages.append(page); self.stack.addWidget(page)
        self.nav.currentRowChanged.connect(self.stack.setCurrentIndex); self.nav.setCurrentRow(0); split = QSplitter(); split.addWidget(self.nav); split.addWidget(self.stack); split.setStretchFactor(1, 1); self.setCentralWidget(split); self.setStatusBar(QStatusBar()); apply_theme(self, True); self.handle("health", None)
    def run(self, fn, done):
        worker = Worker(fn); worker.signals.result.connect(done); worker.signals.error.connect(lambda e: self.statusBar().showMessage(str(e), 7000)); self.pool.start(worker)
    def handle(self, action, payload):
        if action in {"start", "stop", "restart"}: self.run(lambda: self.bridge.service_action(action), self.result)
        elif action == "health": self.run(self.bridge.metrics, self.health)
        elif action == "theme": self.dark = not self.dark; apply_theme(self, self.dark)
        elif action == "logs": self.run(self.bridge.recent_logs, lambda lines: self.pages[4].append("\n".join(lines)))
        elif action == "open_browser": webbrowser.open(self.bridge.settings["health_url"].replace("/api/health", "/"))
        elif action == "validate_path": self.statusBar().showMessage(json.dumps(self.bridge.storage_info(), ensure_ascii=False), 7000)
        elif action == "apply_path": self.run(lambda: self.bridge.set_storage_path(self.pages[2].path.text()) if payload == "Video Storage" else self.bridge.set_database_path(self.pages[3].path.text()), self.result)
        elif action == "open_path": self._open_path(payload)
        elif action == "backup": self.run(lambda: self.bridge.create_backup(self.pages[5].media.isChecked()), self.result)
        elif action == "restore": self._restore()
        elif action == "startup": self.run(lambda: self.bridge.startup(self.pages[8].server.isChecked()), self.result)
        elif action == "diagnostics": self.run(self.bridge.diagnostics, lambda data: self.pages[9].output.setPlainText(json.dumps(data, ensure_ascii=False, indent=2)))
        elif action == "update_status": self.run(self.bridge.update_status, lambda data: self.pages[7].info.setPlainText(json.dumps(data, ensure_ascii=False, indent=2)))
        elif action == "diagnostics_export":
            target, _ = QFileDialog.getSaveFileName(self, "Export diagnostics", "20negar-diagnostics.json", "JSON (*.json)"); target and self.run(lambda: self.bridge.export_diagnostics(__import__('pathlib').Path(target)), self.result)
        elif action == "save_settings": self.run(lambda: self.bridge.save_settings({"port": self.pages[10].port.value(), "mode": self.pages[10].mode.currentText()}), self.result)
    def _open_path(self, name):
        page = self.pages[2] if name == "Video Storage" else self.pages[3]; path = page.path.text()
        try: __import__('os').startfile(path)
        except (AttributeError, OSError) as exc: self.statusBar().showMessage(str(exc), 5000)
    def _restore(self):
        archive, _ = QFileDialog.getOpenFileName(self, "Choose backup", str(self.bridge.paths.backups_dir), "ZIP (*.zip)")
        if archive and QMessageBox.question(self, "Confirm restore", "Create a recovery snapshot and restore this backup?") == QMessageBox.Yes: self.run(lambda: self.bridge.restore_backup(__import__('pathlib').Path(archive)), self.result)
    def result(self, data): self.statusBar().showMessage(json.dumps(data, ensure_ascii=False), 8000); self.pages[1].show_result(data)
    def health(self, data): self.pages[0].set_health(data); self.statusBar().showMessage(str(data.get("status", "unknown")), 3000)
