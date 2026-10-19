import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from app.core.single_instance import SingleInstance, default_name


def test_second_instance_activates_the_first(tmp_path):
    app = QApplication.instance() or QApplication([])
    name = f"20negar-test-{os.getpid()}"
    first = SingleInstance(name)
    assert first.acquire()

    fired = []
    first.activated.connect(lambda: fired.append(True))
    second = SingleInstance(name)
    assert not second.acquire()

    for _ in range(20):
        app.processEvents()
        if fired:
            break
    assert fired, "the running instance was not asked to come forward"

    first.release()


def test_default_name_is_stable_per_user():
    assert default_name() == default_name()
    assert default_name().startswith("20negar-manager-")


def test_socket_is_reusable_after_release():
    app = QApplication.instance() or QApplication([])
    name = f"20negar-reuse-{os.getpid()}"
    first = SingleInstance(name)
    assert first.acquire()
    first.release()
    app.processEvents()
    replacement = SingleInstance(name)
    assert replacement.acquire()
    replacement.release()
