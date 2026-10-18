import sys
from PySide6.QtWidgets import QApplication
from app.ui.main_window import MainWindow

def main():
    QApplication.setApplicationName("20Negar Server Manager")
    QApplication.setOrganizationName("20Negar")
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    return app.exec()

if __name__ == "__main__": sys.exit(main())
