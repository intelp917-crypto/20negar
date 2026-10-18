from app.core.process_manager import ProcessManager

def test_start_uses_shell_false_and_stops():
    calls = {}
    class Fake:
        pid = 123
    def popen(command, **kwargs):
        calls.update(kwargs); return Fake()
    manager = ProcessManager(popen)
    identity = manager.start(["python", "-V"])
    assert identity.pid == 123 and calls["shell"] is False
    assert calls["stderr"] is __import__("subprocess").STDOUT
    assert calls["env"]["PATH"]
