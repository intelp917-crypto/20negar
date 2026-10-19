import sys

from PySide6.QtWidgets import QApplication

from app.ui.icons import app_icon
from app.ui.main_window import MainWindow


def main():
    QApplication.setApplicationName("20Negar Server Manager")
    QApplication.setOrganizationName("20Negar")
    # The window is allowed to close while the manager keeps running in the tray.
    QApplication.setQuitOnLastWindowClosed(False)
    app = QApplication(sys.argv)
    app.setWindowIcon(app_icon())
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
