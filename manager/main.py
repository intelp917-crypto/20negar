import sys

from PySide6.QtWidgets import QApplication

from app.core.single_instance import SingleInstance
from app.ui.icons import app_icon
from app.ui.main_window import MainWindow


def main():
    QApplication.setApplicationName("20Negar Server Manager")
    QApplication.setOrganizationName("20Negar")
    # The window is allowed to close while the manager keeps running in the tray.
    QApplication.setQuitOnLastWindowClosed(False)
    app = QApplication(sys.argv)
    app.setWindowIcon(app_icon())

    # Only one manager per session: a second launch wakes the existing window.
    instance = SingleInstance()
    if not instance.acquire():
        return 0

    window = MainWindow()
    instance.activated.connect(window.restore_window)
    app.aboutToQuit.connect(instance.release)
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
