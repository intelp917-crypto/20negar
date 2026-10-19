"""The play/stop control must follow the real lifecycle, never a stale phase."""
import os
from dataclasses import replace
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import pytest
from PySide6.QtWidgets import QApplication

from app.config.defaults import default_paths
from app.core.bridge import CoreBridge
from app.ui.main_window import MainWindow


@pytest.fixture(scope="module")
def app():
    instance = QApplication.instance() or QApplication([])
    yield instance


@pytest.fixture()
def window(app, tmp_path):
    repo = tmp_path / "repo"
    (repo / "manager").mkdir(parents=True)
    (repo / "package.json").write_text("{}", encoding="utf-8")
    bridge = CoreBridge(replace(default_paths(repo), config_dir=tmp_path / "config"))

    calls: list[str] = []

    def service_action(action: str) -> dict:
        calls.append(action)
        return {"ok": True, "phase": "stopped" if action == "stop" else "starting",
                "pid": None if action == "stop" else 4242}

    bridge.service_action = service_action
    win = MainWindow(bridge)
    win.timer.stop()
    if win.tray is not None:
        win.tray.hide()
        win.tray = None

    def immediate(fn, on_result=None, on_error=None):
        try:
            result = fn()
        except Exception as exc:  # mirrors Worker.signals.error
            if on_error:
                on_error(str(exc))
            return None
        if on_result:
            on_result(result)
        return None

    win.run = immediate  # exercise the same callbacks without a thread race
    win._on_state({"phase": "stopped", "health": {"ok": False}, "port": 3000})
    yield win, calls
    win._quitting = True
    win.close()
    win.deleteLater()
    app.processEvents()


def assert_control(window, action: str, label: str) -> None:
    for page in (window.page_by_name["Dashboard"], window.page_by_name["Server"]):
        assert page.state_button.action == action
        assert label.lower() in page.state_button.text().lower()


def test_start_flips_play_to_stop_only_when_the_server_is_healthy(window):
    win, calls = window
    assert_control(win, "start", "Start server")

    win._service("start")
    assert calls == ["start"]
    # The click immediately shows a transitional, non-clickable state.
    assert_control(win, "start", "Starting")
    assert not win.page_by_name["Dashboard"].state_button.isEnabled()

    # Process alive but health not answering yet: still transitional.
    win._on_state({"phase": "starting", "health": {"ok": False}, "port": 3000})
    assert_control(win, "start", "Starting")

    # Health is up: the same button becomes Stop and is clickable again.
    win._on_state({"phase": "running", "health": {"ok": True}, "port": 3000,
                   "pid": 4242, "managed": True})
    assert_control(win, "stop", "Stop server")
    assert win.page_by_name["Dashboard"].state_button.isEnabled()


def test_stop_flips_back_to_start(window):
    win, _calls = window
    win._on_state({"phase": "running", "health": {"ok": True}, "port": 3000, "pid": 4242})
    assert_control(win, "stop", "Stop server")

    win._service("stop")
    assert_control(win, "stop", "Stopping")

    win._on_state({"phase": "stopped", "health": {"ok": False}, "port": 3000})
    assert_control(win, "start", "Start server")


def test_restart_keeps_the_control_in_a_transitional_state(window):
    win, calls = window
    win._on_state({"phase": "running", "health": {"ok": True}, "port": 3000, "pid": 4242})
    win._service("restart")
    assert calls == ["restart"]
    assert_control(win, "start", "Starting")
    win._on_state({"phase": "running", "health": {"ok": True}, "port": 3000, "pid": 5252})
    assert_control(win, "stop", "Stop server")
