from __future__ import annotations

import json
import re
import time
from pathlib import Path

from PySide6.QtCore import QByteArray, Qt, QThreadPool, QTimer, QUrl
from PySide6.QtGui import QDesktopServices, QFont, QKeySequence, QShortcut
from PySide6.QtWidgets import (QApplication, QFileDialog, QFrame, QHBoxLayout, QLabel,
    QMainWindow, QMessageBox, QProgressDialog, QScrollArea, QStackedWidget, QSystemTrayIcon,
    QVBoxLayout, QWidget)

from .icons import app_icon, brand_pixmap
from .pages import (GROUPS, PAGES, SECTION_OF, BackupsPage, Dashboard, DatabasePage,
    DiagnosticsPage, LogsPage, NetworkPage, PathWizard, ServerPage, SettingsPage,
    StartupPage, StoragePage, TLSPage, UpdatesPage, human_size)
from .theme import apply_theme
from .tray import ManagerTray
from .widgets import Chip, NavItem, SectionLabel, StatusPill, ToastStack, icon_button
from ..core.bridge import APP_VERSION, CoreBridge
from ..workers.tasks import Worker

PAGE_CLASSES = {
    "Dashboard": Dashboard, "Server": ServerPage, "Storage": StoragePage,
    "Database": DatabasePage, "Logs": LogsPage, "Backups": BackupsPage,
    "Network": NetworkPage, "Updates": UpdatesPage, "TLS / HTTPS": TLSPage,
    "Startup": StartupPage, "Diagnostics": DiagnosticsPage, "Settings": SettingsPage,
}

TRANSITIONAL = {"starting", "stopping"}
ACTIVE = {"running", "external", "unhealthy"}


class MainWindow(QMainWindow):
    def __init__(self, bridge: CoreBridge | None = None):
        super().__init__()
        self.bridge = bridge or CoreBridge()
        self.setWindowTitle("20Negar Studio — Server Manager")
        self.setWindowIcon(app_icon())
        self.setMinimumSize(1040, 680)
        self.resize(1310, 850)

        self.pool = QThreadPool(self)
        self.pool.setMaxThreadCount(4)
        self._workers: set[Worker] = set()
        self._state: dict = {"phase": "stopped"}
        self._state_busy = False
        self._phase_hint: tuple[str | None, float] = (None, 0.0)
        # While restarting, the old process keeps reporting "running" until it
        # is stopped. Remember its pid so the stale reading cannot flip the
        # control back to Stop during the restart.
        self._transition_pid: int | None = None
        self._service_busy = False
        self._quitting = False
        self._tray_notice_shown = False
        self._diagnostics_text = ""
        self._progress: QProgressDialog | None = None

        self.dark = str(self.bridge.settings.get("ui_theme", "dark")) != "light"
        apply_theme(QApplication.instance(), self.dark)

        self._build_shell()
        self._restore_window()
        self._setup_tray()
        self._setup_shortcuts()

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh_state)
        self.timer.start(1200)
        self._tls_check_busy = False
        self.tls_timer = QTimer(self)
        self.tls_timer.timeout.connect(self._auto_renew_tls)
        self.tls_timer.start(30 * 60 * 1000)
        QTimer.singleShot(120, lambda: self.refresh_state(force=True))
        QTimer.singleShot(400, self.refresh_backups)
        QTimer.singleShot(25000, self._auto_renew_tls)

    # ------------------------------------------------------------------
    # Shell
    # ------------------------------------------------------------------
    def _build_shell(self) -> None:
        root = QWidget()
        root.setObjectName("Root")
        layout = QHBoxLayout(root)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.addWidget(self._build_sidebar())

        right = QVBoxLayout()
        right.setContentsMargins(0, 0, 0, 0)
        right.setSpacing(0)
        right.addWidget(self._build_topbar())
        self.stack = QStackedWidget()
        self.pages = []
        self.page_by_name = {}
        for name in PAGES:
            page = PAGE_CLASSES[name](name, self.bridge)
            page.action.connect(self.handle)
            self.pages.append(page)
            self.page_by_name[name] = page
            self.stack.addWidget(page)
        right.addWidget(self.stack, 1)
        layout.addLayout(right, 1)
        self.setCentralWidget(root)

        self.toasts = ToastStack(root)
        self.toasts.raise_()
        self.navigate(self.bridge.settings.get("last_page") if
                      self.bridge.settings.get("last_page") in PAGES else "Dashboard")

    def _build_sidebar(self) -> QWidget:
        side = QWidget()
        side.setObjectName("Sidebar")
        side.setFixedWidth(254)
        column = QVBoxLayout(side)
        column.setContentsMargins(14, 20, 14, 14)
        column.setSpacing(10)

        brand = QHBoxLayout()
        brand.setSpacing(11)
        mark = QLabel()
        mark.setPixmap(brand_pixmap(36))
        mark.setFixedSize(36, 36)
        texts = QVBoxLayout()
        texts.setSpacing(0)
        name = QLabel("20NEGAR")
        name.setObjectName("BrandName")
        sub = QLabel("SERVER MANAGER")
        sub.setObjectName("BrandSub")
        subfont = QFont(sub.font())
        subfont.setLetterSpacing(QFont.AbsoluteSpacing, 1.2)
        sub.setFont(subfont)
        texts.addWidget(name)
        texts.addWidget(sub)
        brand.addWidget(mark)
        brand.addLayout(texts)
        brand.addStretch(1)
        column.addLayout(brand)
        column.addSpacing(8)

        nav_scroll = QScrollArea()
        nav_scroll.setWidgetResizable(True)
        nav_scroll.setFrameShape(QScrollArea.NoFrame)
        nav_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        nav_inner = QWidget()
        nav_inner.setObjectName("NavBody")
        nav = QVBoxLayout(nav_inner)
        nav.setContentsMargins(0, 0, 0, 0)
        nav.setSpacing(2)
        self.nav_items: dict[str, NavItem] = {}
        for group, items in GROUPS.items():
            nav.addSpacing(6)
            nav.addWidget(SectionLabel(group))
            nav.addSpacing(2)
            for page_name, glyph in items:
                item = NavItem(glyph, page_name)
                item.clicked.connect(lambda name=page_name: self.navigate(name))
                nav.addWidget(item)
                self.nav_items[page_name] = item
        nav.addStretch(1)
        nav_scroll.setWidget(nav_inner)
        column.addWidget(nav_scroll, 1)

        footer = QFrame()
        footer.setObjectName("SidebarFooter")
        foot = QVBoxLayout(footer)
        foot.setContentsMargins(12, 11, 12, 11)
        foot.setSpacing(8)
        top = QHBoxLayout()
        self.side_pill = StatusPill()
        top.addWidget(self.side_pill)
        top.addStretch(1)
        foot.addLayout(top)
        host_row = QHBoxLayout()
        self.side_host = QLabel(f"localhost:{self.bridge.settings.get('port', 3000)}")
        self.side_host.setObjectName("Faint")
        self.side_version = QLabel(f"v{APP_VERSION}")
        self.side_version.setObjectName("Faint")
        host_row.addWidget(self.side_host)
        host_row.addStretch(1)
        host_row.addWidget(self.side_version)
        foot.addLayout(host_row)
        row = QHBoxLayout()
        row.setSpacing(4)
        theme_button = icon_button("◐", "Toggle theme (Ctrl+T)")
        theme_button.clicked.connect(self.toggle_theme)
        hide_button = icon_button("⌄", "Hide to the system tray")
        hide_button.clicked.connect(self.hide_to_tray)
        settings_button = icon_button("⚙", "Open settings")
        settings_button.clicked.connect(lambda: self.navigate("Settings"))
        row.addWidget(theme_button)
        row.addWidget(settings_button)
        row.addStretch(1)
        row.addWidget(hide_button)
        foot.addLayout(row)
        column.addWidget(footer)
        return side

    def _build_topbar(self) -> QWidget:
        bar = QWidget()
        bar.setObjectName("TopBar")
        bar.setFixedHeight(64)
        row = QHBoxLayout(bar)
        row.setContentsMargins(28, 0, 20, 0)
        row.setSpacing(10)
        self.breadcrumb = QLabel("OVERVIEW  /  DASHBOARD")
        self.breadcrumb.setObjectName("Breadcrumb")
        font = QFont(self.breadcrumb.font())
        font.setLetterSpacing(QFont.AbsoluteSpacing, 1.1)
        self.breadcrumb.setFont(font)
        row.addWidget(self.breadcrumb)
        row.addStretch(1)
        self.top_pill = StatusPill()
        row.addWidget(self.top_pill)
        refresh = icon_button("↻", "Refresh now (F5)")
        refresh.clicked.connect(lambda: self.refresh_state(force=True))
        theme_button = icon_button("◐", "Toggle theme (Ctrl+T)")
        theme_button.clicked.connect(self.toggle_theme)
        hide_button = icon_button("⌄", "Hide to the system tray")
        hide_button.clicked.connect(self.hide_to_tray)
        for widget in (refresh, theme_button, hide_button):
            row.addWidget(widget)
        return bar

    # ------------------------------------------------------------------
    # Navigation and state
    # ------------------------------------------------------------------
    def navigate(self, name: str) -> None:
        if name not in self.page_by_name:
            return
        self.stack.setCurrentWidget(self.page_by_name[name])
        for page_name, item in self.nav_items.items():
            item.set_active(page_name == name)
        self.breadcrumb.setText(f"{SECTION_OF[name].upper()}  /  {name.upper()}")
        self.bridge.save_settings({"last_page": name}, sync_env=False)
        if name == "Backups":
            self.refresh_backups()

    def refresh_state(self, force: bool = False) -> None:
        if self._state_busy:
            return
        self._state_busy = True
        worker = Worker(self.bridge.state)
        worker.signals.result.connect(self._on_state)
        worker.signals.error.connect(self._on_state_error)
        worker.signals.finished.connect(self._on_state_done)
        self._workers.add(worker)
        self.pool.start(worker)

    def _on_state_done(self) -> None:
        self._state_busy = False
        self._reschedule()

    def _on_state_error(self, message: str) -> None:
        self._state_busy = False
        self.toast(message or "Could not read the server state.", "error")

    def _on_state(self, state: dict) -> None:
        self._state = state
        self._apply_phase()
        self._refresh_logs()
        self.side_host.setText(f"localhost:{state.get('port', self.bridge.settings.get('port', 3000))}")

    def _effective_phase(self, state: dict) -> str:
        hint, started = self._phase_hint
        actual = str(state.get("phase", "stopped"))
        if not hint:
            return actual
        elapsed = time.monotonic() - started
        timeout = float(self.bridge.settings["startup_timeout"])
        if hint == "starting":
            ready = actual in {"running", "external", "unhealthy"}
            # A restart still sees the previous process for a moment; that is
            # not the new server and must not clear the transitional state.
            if ready and self._transition_pid is not None \
                    and state.get("pid") == self._transition_pid:
                ready = False
            crashed = (actual == "stopped" and elapsed > 2.5
                       and not self._service_busy)
            if ready or crashed or elapsed > timeout:
                self._clear_hint()
                return actual
            return "starting"
        if hint == "stopping":
            if actual == "stopped" or elapsed > 8:
                self._clear_hint()
                return actual
            return "stopping"
        return actual

    def _clear_hint(self) -> None:
        self._phase_hint = (None, 0.0)
        self._transition_pid = None

    def _apply_phase(self) -> None:
        phase = self._effective_phase(self._state)
        display = {**self._state, "phase": phase}
        self.top_pill.set_phase(phase)
        self.side_pill.set_phase(phase)
        if self.tray is not None:
            self.tray.set_state(display)
        for page in self.pages:
            page.on_state(display)

    def _reschedule(self) -> None:
        base = max(1, int(self.bridge.settings.get("monitor_interval", 5))) * 1000
        phase = self._state.get("phase", "stopped")
        busy = phase in TRANSITIONAL or self._phase_hint[0] is not None
        self.timer.setInterval(1000 if busy else max(1500, base))

    def _refresh_logs(self) -> None:
        lines = self.bridge.recent_logs(400)
        for page in self.pages:
            setter = getattr(page, "set_logs", None)
            if setter:
                setter(lines)

    # ------------------------------------------------------------------
    # Server lifecycle
    # ------------------------------------------------------------------
    def _toggle_server(self) -> None:
        phase = self._effective_phase(self._state)
        self._service("stop" if phase in ACTIVE else "start")

    def _service(self, action: str) -> None:
        phase = self._effective_phase(self._state)
        if phase in TRANSITIONAL:
            self.toast("The server is still changing state — one moment.", "info")
            return
        hint = "starting" if action in {"start", "restart"} else "stopping"
        self._phase_hint = (hint, time.monotonic())
        self._transition_pid = (self._state.get("pid")
                                if action == "restart" else None)
        self._service_busy = True
        self._apply_phase()
        self.run(lambda: self.bridge.service_action(action), self._service_done, self._failure)
        self._reschedule()

    def _service_done(self, result: dict) -> None:
        self._service_busy = False
        if not isinstance(result, dict):
            self._failure("Unexpected response from the server controller")
            return
        if not result.get("ok"):
            self._clear_hint()
            self.toast(result.get("message") or "The action did not complete.", "error")
        elif result.get("message"):
            self._clear_hint()
            self.toast(str(result["message"]), "info")
        elif result.get("phase") == "stopped":
            self._phase_hint = ("stopping", time.monotonic())
            self._transition_pid = None
            self.toast("Server stopped", "success")
        else:
            self.toast("Server is starting — health check in progress", "success")
        self._apply_phase()
        QTimer.singleShot(220, lambda: self.refresh_state(force=True))

    def _failure(self, message: str) -> None:
        self._service_busy = False
        self._clear_hint()
        self.toast(message or "The operation failed.", "error")
        self.refresh_state(force=True)

    # ------------------------------------------------------------------
    # Actions from pages
    # ------------------------------------------------------------------
    def handle(self, action: str, payload=None) -> None:
        if action == "refresh":
            self.refresh_state(force=True)
        elif action in {"start", "stop", "restart"}:
            self._service(action)
        elif action == "logs":
            self._refresh_logs()
            self.toast("Log tail refreshed", "info")
        elif action == "navigate":
            self.navigate(str(payload))
        elif action == "open_browser":
            self._open_browser()
        elif action == "path_wizard":
            self._open_wizard(str(payload))
        elif action == "open_path":
            self._open_path(str(payload))
        elif action == "open_config":
            self._open_path("config")
        elif action == "validate_db":
            self.bridge_validate_database()
        elif action == "validate_storage":
            self.run(self.bridge.storage_info, self._storage_checked, self._failure)
        elif action == "reset_videos":
            self._reset_videos()
        elif action == "backup":
            self._create_backup()
        elif action == "restore":
            self._restore()
        elif action == "backups_list":
            self.refresh_backups()
        elif action == "startup":
            self._apply_startup(payload or self.page_by_name["Startup"].values())
        elif action == "diagnostics":
            self._collect_diagnostics()
        elif action == "diagnostics_export":
            self._export_diagnostics()
        elif action == "copy_diagnostics":
            QApplication.clipboard().setText(self._diagnostics_text or "Nothing collected yet.")
            self.toast("Diagnostics copied", "success")
        elif action == "copy_logs":
            QApplication.clipboard().setText("\n".join(self.bridge.recent_logs(800)))
            self.toast("Log tail copied", "success")
        elif action == "clear_console":
            self.bridge.clear_output()
            self._refresh_logs()
        elif action in {"update_status", "update_check"}:
            self._check_updates()
        elif action == "update_apply":
            self._confirm_update()
        elif action == "probe_network":
            self.run(self.bridge.probe, self._probe_ready, self._failure)
        elif action == "tls_status":
            self._refresh_tls()
        elif action == "tls_self_signed":
            self._install_self_signed()
        elif action == "tls_issue":
            self._request_certificate()
        elif action == "tls_renew":
            self._renew_certificate()
        elif action == "tls_save":
            self._save_tls(payload or {})
        elif action == "save_settings":
            self._save_settings()
        elif action == "sync_env":
            self._sync_env()
        elif action == "theme":
            self.toggle_theme()
        elif action == "theme_set":
            self.set_theme(str(payload) == "dark")
        elif action == "open_settings":
            self.navigate("Settings")

    # -- storage / database ---------------------------------------------
    def _open_wizard(self, kind: str) -> None:
        page = self.page_by_name["Database" if kind == "database" else "Storage"]
        current = (page.path_field.text() if kind == "database"
                   else page.videos_field.text() if kind == "videos"
                   else page.path_field.text())
        wizard = PathWizard(self, self.bridge, kind, current)
        wizard.confirmed.connect(self._apply_path)
        wizard.exec()

    def _apply_path(self, kind: str, options: dict) -> None:
        title = "Updating media storage" if kind == "storage" else "Moving the database"
        self._progress = self._begin_progress(title, "Stopping the server, verifying files…")

        def task():
            if kind == "storage":
                return self.bridge.apply_storage_path(
                    options["path"], bool(options.get("migrate")), bool(options.get("restart", True)))
            if kind == "videos":
                return self.bridge.apply_videos_path(
                    options["path"], bool(options.get("migrate")), bool(options.get("restart", True)))
            return self.bridge.apply_database_path(
                options["path"], str(options.get("mode", "replace")), bool(options.get("restart", True)))

        def done(result: dict) -> None:
            self._end_progress()
            if not result.get("changed"):
                self.toast("The destination is unchanged.", "info")
            elif kind in {"storage", "videos"}:
                extra = f" · {result.get('copied_files', 0)} files verified" if result.get("migrated") else ""
                label = "Videos folder" if kind == "videos" else "Storage destination"
                self.toast(f"{label} updated{extra}", "success")
                if result.get("verified") is False:
                    self.toast("Restart the server to confirm the new path", "warning")
            elif result.get("verified"):
                self.toast("Database moved — the server is using the new file", "success")
            elif result.get("restarted"):
                self.toast("Database moved, but the server has not confirmed the new path. "
                           "Check Logs for [Config] Database file.", "warning")
            else:
                self.toast("Database moved — restart the server to apply", "success")
            self.refresh_state(force=True)
            self.refresh_backups()
            self.navigate("Database" if kind == "database" else "Storage")

        def failed(message: str) -> None:
            self._end_progress()
            self._failure(message)

        self.run(task, done, failed)

    def bridge_validate_database(self) -> None:
        def done(result: dict) -> None:
            self.page_by_name["Database"].set_validation(result)
            self.toast("Database integrity is valid" if result.get("valid")
                       else "Database integrity check failed", "success" if result.get("valid") else "error")
            self.refresh_state(force=True)
        self.run(self.bridge.validate_database, done, self._failure)

    def _reset_videos(self) -> None:
        if not self.bridge.settings.get("videos_dir"):
            self.toast("Videos already use the storage folder", "info")
            return
        self._progress = self._begin_progress("Resetting videos folder",
                                             "Switching back to <storage>/videos…")

        def done(result: dict) -> None:
            self._end_progress()
            if not result.get("changed"):
                self.toast("The videos folder is unchanged.", "info")
            else:
                self.toast("Videos now use the storage folder — restart the server to apply"
                           if not result.get("restarted") else
                           "Videos now use the storage folder", "success")
            self.refresh_state(force=True)
            self.navigate("Storage")

        self.run(self.bridge.reset_videos_path, done, self._failure)

    def _storage_checked(self, info: dict) -> None:
        if info.get("exists"):
            self.toast(f"Storage is reachable · {human_size(info.get('free', 0))} free", "success")
        else:
            self.toast("The storage folder does not exist yet — it will be created on save.", "warning")

    # -- backups --------------------------------------------------------
    def refresh_backups(self) -> None:
        self.run(self.bridge.backups, self._backups_ready, self._failure)

    def _backups_ready(self, entries: list[dict]) -> None:
        self.page_by_name["Backups"].set_backups(entries or [])

    def _create_backup(self) -> None:
        include = self.page_by_name["Backups"].media.isChecked()
        self._progress = self._begin_progress("Creating backup", "Writing a verified ZIP archive…")

        def done(result: dict) -> None:
            self._end_progress()
            self.toast(f"Backup created · {human_size(result.get('size', 0))}", "success")
            self.refresh_backups()

        def failed(message: str) -> None:
            self._end_progress()
            self._failure(message)

        self.run(lambda: self.bridge.create_backup(include), done, failed)

    def _restore(self) -> None:
        page = self.page_by_name["Backups"]
        selected = page.selected_path()
        if selected:
            archive = selected
        else:
            archive, _ = QFileDialog.getOpenFileName(
                self, "Choose a backup", str(self.bridge.paths.backups_dir), "ZIP archives (*.zip)")
        if not archive:
            return
        confirm = QMessageBox(self)
        confirm.setWindowTitle("Restore backup")
        confirm.setText("Restore this snapshot?")
        confirm.setInformativeText(
            f"{Path(archive).name}\n\nA recovery snapshot is created first, then the database "
            "and media files in the archive are written back.")
        confirm.setIcon(QMessageBox.Warning)
        confirm.setStandardButtons(QMessageBox.Yes | QMessageBox.Cancel)
        confirm.setDefaultButton(QMessageBox.Cancel)
        if confirm.exec() != QMessageBox.Yes:
            return
        self._progress = self._begin_progress("Restoring backup", "Verifying and writing files…")

        def done(result: dict) -> None:
            self._end_progress()
            if result.get("ok"):
                self.toast("Backup restored", "success")
                self.refresh_state(force=True)
                self.refresh_backups()
            else:
                self.toast(result.get("message") or "Restore failed", "error")

        def failed(message: str) -> None:
            self._end_progress()
            self._failure(message)

        self.run(lambda: self.bridge.restore_backup(Path(archive)), done, failed)

    # -- startup / diagnostics / settings -------------------------------
    def _apply_startup(self, payload: dict) -> None:
        manager = bool(payload.get("manager"))
        server = bool(payload.get("server"))

        def done(result: dict) -> None:
            self.toast("Startup entries updated", "success")
            self.refresh_state(force=True)

        self.run(lambda: self.bridge.startup(manager, server), done, self._failure)

    def _collect_diagnostics(self) -> None:
        def done(data: dict) -> None:
            self._diagnostics_text = json.dumps(data, ensure_ascii=False, indent=2)
            self.page_by_name["Diagnostics"].set_report(self._diagnostics_text)
            self.toast("Diagnostics collected", "success")
        self.run(self.bridge.diagnostics, done, self._failure)

    def _export_diagnostics(self) -> None:
        target, _ = QFileDialog.getSaveFileName(
            self, "Export diagnostics", "20negar-diagnostics.json", "JSON (*.json)")
        if not target:
            return

        def done(path: Path) -> None:
            self.toast(f"Exported to {path}", "success")
        self.run(lambda: self.bridge.export_diagnostics(Path(target)), done, self._failure)

    # -- updates --------------------------------------------------------
    def _check_updates(self) -> None:
        page = self.page_by_name["Updates"]
        page.set_busy(True)
        self.run(self.bridge.update_check, self._update_checked, self._update_failed)

    def _update_checked(self, data: dict) -> None:
        page = self.page_by_name["Updates"]
        page.set_check(data or {})
        if (data or {}).get("error"):
            self.toast(data["error"], "error")
        elif data.get("up_to_date"):
            self.toast("You are running the latest version", "success")
        elif data.get("can_apply"):
            self.toast(data.get("message") or "An update is available", "info")
        else:
            self.toast(data.get("message") or "No update can be applied", "warning")

    def _update_failed(self, message: str) -> None:
        self.page_by_name["Updates"].set_busy(False)
        self._failure(message)

    def _confirm_update(self) -> None:
        page = self.page_by_name["Updates"]
        check = page.data()
        if not check.get("can_apply"):
            self.toast("Check for updates first — there is nothing to install.", "info")
            return
        box = QMessageBox(self)
        box.setWindowTitle("Update 20Negar")
        box.setIcon(QMessageBox.Question)
        box.setText("Install the latest version from GitHub?")
        details = [
            f"Branch {check.get('branch') or 'main'}: "
            f"{(check.get('commit') or '')[:10]} → {(check.get('remote_commit') or '')[:10]}",
            f"{check.get('behind', 0)} new commit(s), {len(check.get('files_changed') or [])} file(s) changed.",
        ]
        if check.get("dependencies_changed"):
            details.append("Dependencies changed — npm install will run (this can take a few minutes).")
        details.append("The server is stopped, the database is backed up, then the server is started again.")
        box.setInformativeText("\n".join(details))
        confirm = box.addButton("Update now", QMessageBox.AcceptRole)
        cancel = box.addButton("Cancel", QMessageBox.RejectRole)
        box.setDefaultButton(cancel)
        box.exec()
        if box.clickedButton() is not confirm:
            return

        page.set_busy(True)
        self._progress = self._begin_progress(
            "Updating from GitHub",
            "Stopping the server, backing up the database and pulling the latest commit…")
        self.run(self.bridge.apply_update, self._update_applied, self._update_failed)

    def _update_applied(self, result: dict) -> None:
        self._end_progress()
        page = self.page_by_name["Updates"]
        page.set_busy(False)
        result = result or {}
        if not result.get("ok"):
            if result.get("check"):
                page.set_check(result["check"])
            self.toast(result.get("message") or "The update failed", "error", 8000)
            self.refresh_state(force=True)
            return
        if not result.get("changed"):
            self.toast(result.get("message") or "Already up to date", "info")
            self._check_updates()
            return
        short = str(result.get("to_commit") or "")[:10]
        self.toast(f"Updated to {short or 'the latest commit'}", "success")
        if result.get("manager_changed"):
            self.toast("The manager itself was updated — restart it to load the new version.",
                       "warning", 9000)
        self.refresh_state(force=True)
        QTimer.singleShot(400, self._check_updates)

    # -- HTTPS certificates ---------------------------------------------
    def _refresh_tls(self) -> None:
        self.run(self.bridge.tls_status, self._tls_ready, self._failure)

    def _tls_ready(self, data: dict) -> None:
        self.page_by_name["TLS / HTTPS"].set_status(data or {})

    def _tls_done(self, result: dict) -> None:
        self._end_progress()
        result = result or {}
        if not result.get("ok"):
            self._failure(result.get("message") or "The certificate operation failed.")
            return
        page = self.page_by_name["TLS / HTTPS"]
        page.set_status(result)
        self.toast(result.get("message") or "Certificate installed", "success", 6000)
        if result.get("warning"):
            self.toast(result["warning"], "warning", 8000)
        elif result.get("restarted") and not result.get("healthy", True):
            self.toast("The server has not reported healthy yet — check Logs.", "warning", 7000)
        self.refresh_state(force=True)

    def _tls_failed(self, message: str) -> None:
        self._end_progress()
        self._failure(message)

    def _install_self_signed(self) -> None:
        box = QMessageBox(self)
        box.setWindowTitle("HTTPS certificate")
        box.setText("Install a self-signed certificate?")
        box.setInformativeText(
            "This replaces the current certificate. Self-signed certificates encrypt the "
            "connection but browsers and phones will show a warning until the certificate "
            "is trusted.")
        box.setIcon(QMessageBox.Warning)
        confirm = box.addButton("Install", QMessageBox.AcceptRole)
        box.addButton("Cancel", QMessageBox.RejectRole)
        box.setDefaultButton(box.buttons()[-1])
        box.exec()
        if box.clickedButton() is not confirm:
            return
        self._progress = self._begin_progress("Creating certificate",
                                             "Generating a self-signed key pair…")
        self.run(self.bridge.tls_install_self_signed, self._tls_done, self._tls_failed)

    def _request_certificate(self) -> None:
        page = self.page_by_name["TLS / HTTPS"]
        values = page.preferences()
        domain = values["tls_domain"]
        if not domain:
            self.toast("Enter the domain name that points at this server.", "warning")
            page.domain_edit.setFocus()
            return
        if "." not in domain or "/" in domain:
            self.toast("Enter a full domain such as studio.example.com", "warning")
            page.domain_edit.setFocus()
            return
        box = QMessageBox(self)
        box.setWindowTitle("Let's Encrypt")
        box.setText(f"Request a certificate for {domain}?")
        details = ["Let's Encrypt validates the domain over HTTP on port 80.",
                   "Port 80 must reach this server, and the domain must point at this IP.",
                   "The server restarts once to load the new certificate."]
        if values["tls_staging"]:
            details.append("Staging mode: the result is a test certificate, not trusted by browsers.")
        box.setInformativeText("\n".join(details))
        box.setIcon(QMessageBox.Question)
        confirm = box.addButton("Request certificate", QMessageBox.AcceptRole)
        box.addButton("Cancel", QMessageBox.RejectRole)
        box.setDefaultButton(box.buttons()[-1])
        box.exec()
        if box.clickedButton() is not confirm:
            return
        self._progress = self._begin_progress(
            "Requesting a certificate",
            "Creating the ACME order and answering the HTTP-01 challenge…")
        self.run(lambda: self.bridge.tls_issue(domain, values["tls_email"],
                                               values["tls_staging"]),
                 self._tls_done, self._tls_failed)

    def _renew_certificate(self) -> None:
        page = self.page_by_name["TLS / HTTPS"]
        values = page.preferences()
        if not values["tls_domain"]:
            self.toast("Set the domain first, then renew.", "warning")
            return
        self._progress = self._begin_progress("Renewing certificate",
                                             "Requesting a fresh certificate from Let's Encrypt…")
        self.run(self.bridge.tls_renew, self._tls_done, self._tls_failed)

    def _save_tls(self, payload: dict) -> None:
        page = self.page_by_name["TLS / HTTPS"]
        values = payload or page.preferences()

        def done(data: dict) -> None:
            page.set_status(data or {})
            self.toast("Certificate preferences saved", "success")

        self.run(lambda: self.bridge.tls_save(values), done, self._failure)

    def _auto_renew_tls(self) -> None:
        if self._tls_check_busy or not self.bridge.settings.get("tls_autorenew", True):
            return
        last = float(self.bridge.settings.get("tls_last_check") or 0)
        if last and time.time() - last < 12 * 3600:
            return
        self._tls_check_busy = True

        def done(result: dict) -> None:
            self._tls_check_busy = False
            result = result or {}
            if result.get("renewed"):
                self.toast("Let's Encrypt certificate renewed automatically", "success", 7000)
                self._refresh_tls()
                self.refresh_state(force=True)
            elif result.get("reason") == "failed":
                self.toast(result.get("message") or "Automatic certificate renewal failed",
                           "warning", 9000)
            self._refresh_tls()

        def failed(message: str) -> None:
            self._tls_check_busy = False
            self.toast(f"Certificate renewal check failed: {message}", "warning", 7000)

        self.run(self.bridge.tls_renew_if_needed, done, failed)

    def _probe_ready(self, result: dict) -> None:
        self.page_by_name["Network"].set_probe(result)
        if result.get("ok"):
            self.toast(f"Health endpoint reachable · {result.get('latency_ms', '—')} ms", "success")
        else:
            self.toast(f"Health endpoint unreachable: {result.get('error') or 'no response'}", "error")

    def _save_settings(self) -> None:
        page = self.page_by_name["Settings"]
        values = page.values()
        old_port = self.bridge.settings.get("port")
        # Keep the health probe on the same port the server will listen on.
        if values.get("port") != old_port:
            updated = re.sub(rf":{old_port}\b", f":{values['port']}", str(values.get("health_url", "")))
            values["health_url"] = updated
            page.health_url.setText(updated)

        def done(settings: dict) -> None:
            self.toast("Settings saved", "success")
            if settings.get("port") != old_port:
                self.toast("Port changes take effect after a server restart", "warning")
            self._reschedule()
            self.refresh_state(force=True)
        self.run(lambda: self.bridge.save_settings(values), done, self._failure)

    def _sync_env(self) -> None:
        def done(settings: dict) -> None:
            self.toast("Runtime configuration synced to .env", "success")
            self.refresh_state(force=True)
        self.run(lambda: self.bridge.save_settings({}), done, self._failure)

    # ------------------------------------------------------------------
    # Theme, tray, window
    # ------------------------------------------------------------------
    def toggle_theme(self) -> None:
        self.set_theme(not self.dark)

    def set_theme(self, dark: bool) -> None:
        self.dark = dark
        apply_theme(QApplication.instance(), dark)
        for widget in QApplication.instance().allWidgets():
            if isinstance(widget, Chip):
                widget.refresh()
        self.bridge.save_settings({"ui_theme": "dark" if dark else "light"}, sync_env=False)
        self.toast(f"{'Dark' if dark else 'Light'} theme applied", "info", 2200)

    def _setup_tray(self) -> None:
        self.tray: ManagerTray | None = None
        if not QSystemTrayIcon.isSystemTrayAvailable():
            return
        self.tray = ManagerTray(self)
        self.tray.open_requested.connect(self.restore_window)
        self.tray.settings_requested.connect(self._open_settings_from_tray)
        self.tray.toggle_server_requested.connect(self._toggle_server)
        self.tray.restart_requested.connect(lambda: self._service("restart"))
        self.tray.exit_requested.connect(self.request_exit)
        self.tray.set_state({"phase": "stopped"})
        self.tray.show()

    def _open_settings_from_tray(self) -> None:
        self.restore_window()
        self.navigate("Settings")

    def restore_window(self) -> None:
        self.showNormal()
        self.raise_()
        self.activateWindow()

    def hide_to_tray(self) -> None:
        if self.tray is None:
            self.showMinimized()
            return
        self.hide()
        if not self._tray_notice_shown:
            self._tray_notice_shown = True
            self.tray.showMessage(
                "20Negar Manager is still running",
                "Right-click the tray icon next to the clock to open or exit.",
                QSystemTrayIcon.Information, 5000)

    def _setup_shortcuts(self) -> None:
        QShortcut(QKeySequence("F5"), self, activated=lambda: self.refresh_state(force=True))
        QShortcut(QKeySequence("Ctrl+R"), self, activated=lambda: self._service("restart"))
        QShortcut(QKeySequence("Ctrl+Shift+S"), self, activated=self._toggle_server)
        QShortcut(QKeySequence("Ctrl+T"), self, activated=self.toggle_theme)
        QShortcut(QKeySequence("Ctrl+Q"), self, activated=self.request_exit)

    def request_exit(self) -> None:
        phase = self._effective_phase(self._state)
        running = phase in ACTIVE or phase in TRANSITIONAL
        box = QMessageBox(self)
        box.setWindowTitle("Exit 20Negar Manager")
        stop_button = keep_button = None
        if running:
            box.setText("The server is still running.")
            box.setInformativeText(
                "Closing the manager does not stop the studio. Choose how to exit.")
            stop_button = box.addButton("Stop server and exit", QMessageBox.AcceptRole)
            keep_button = box.addButton("Exit and keep server running", QMessageBox.ActionRole)
            box.addButton("Cancel", QMessageBox.RejectRole)
        else:
            box.setText("Close the manager?")
            box.setInformativeText("The tray icon will disappear and the manager will stop.")
            keep_button = box.addButton("Exit", QMessageBox.AcceptRole)
            box.addButton("Cancel", QMessageBox.RejectRole)
        box.setDefaultButton(box.buttons()[-1])
        box.exec()
        clicked = box.clickedButton()
        if clicked is stop_button:
            self._quit(stop_server=True)
        elif clicked is keep_button:
            self._quit(stop_server=False)

    def _quit(self, stop_server: bool) -> None:
        self._quitting = True
        if stop_server:
            self._progress = self._begin_progress("Stopping the server", "Waiting for the process to exit…")
            self.run(self.bridge.stop_server, lambda _result: self.finish_quit(),
                     lambda _message: self.finish_quit())
        else:
            self.finish_quit()

    def finish_quit(self) -> None:
        self._end_progress()
        self._save_window()
        self.timer.stop()
        if self.tray is not None:
            self.tray.hide()
        self.pool.waitForDone(2000)
        QApplication.instance().quit()

    def _save_window(self) -> None:
        try:
            geometry = bytes(self.saveGeometry().toBase64()).decode("ascii")
            self.bridge.save_settings({"window_geometry": geometry}, sync_env=False)
        except (OSError, ValueError):
            pass

    def _restore_window(self) -> None:
        geometry = self.bridge.settings.get("window_geometry")
        if isinstance(geometry, str) and geometry:
            try:
                self.restoreGeometry(QByteArray.fromBase64(geometry.encode("ascii")))
            except (ValueError, TypeError):
                pass

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        if hasattr(self, "toasts"):
            self.toasts.setGeometry(self.centralWidget().rect())
            self.toasts.raise_()

    def closeEvent(self, event) -> None:
        if self._quitting:
            self._save_window()
            event.accept()
            return
        if self.tray is not None and self.bridge.settings.get("close_to_tray", True):
            event.ignore()
            self.hide_to_tray()
            return
        event.ignore()
        self.request_exit()

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------
    def run(self, fn, on_result=None, on_error=None):
        worker = Worker(fn)
        if on_result:
            worker.signals.result.connect(on_result)
        if on_error:
            worker.signals.error.connect(on_error)
        worker.signals.finished.connect(lambda: self._workers.discard(worker))
        self._workers.add(worker)
        self.pool.start(worker)
        return worker

    def _begin_progress(self, title: str, text: str) -> QProgressDialog:
        dialog = QProgressDialog(text, None, 0, 0, self)
        dialog.setWindowTitle(title)
        dialog.setWindowModality(Qt.WindowModal)
        dialog.setMinimumWidth(430)
        dialog.setMinimumDuration(0)
        dialog.setAutoClose(False)
        dialog.setAutoReset(False)
        dialog.show()
        return dialog

    def _end_progress(self) -> None:
        if self._progress is not None:
            self._progress.close()
            self._progress.deleteLater()
            self._progress = None

    def toast(self, message: str, tone: str = "info", timeout: int = 4200) -> None:
        self.toasts.show_toast(message, tone, timeout)
        if not self.isVisible() and self.tray is not None and tone in {"success", "error"}:
            icon = QSystemTrayIcon.Information if tone == "success" else QSystemTrayIcon.Warning
            self.tray.showMessage("20Negar Manager", message, icon, 4000)

    def _open_browser(self) -> None:
        url = str(self.bridge.settings.get("health_url", "")).replace("/api/health", "/")
        if not QDesktopServices.openUrl(QUrl(url)):
            self.toast(f"Could not open {url}", "error")

    def _open_path(self, name: str) -> None:
        mapping = {
            "storage": self.bridge.paths.storage_dir,
            "videos": self.bridge.videos_dir,
            "database": self.bridge.paths.database.parent,
            "backups": self.bridge.paths.backups_dir,
            "config": self.bridge.store.path.parent,
        }
        target = mapping.get(name)
        if target is None:
            self.toast("Unknown folder", "error")
            return
        try:
            target.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            self.toast(str(exc), "error")
            return
        if not QDesktopServices.openUrl(QUrl.fromLocalFile(str(target))):
            self.toast(f"Could not open {target}", "error")
