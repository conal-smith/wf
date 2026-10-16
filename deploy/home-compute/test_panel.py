"""deploy/home-compute/panel.py: a service is "stopped" only when launchd says so.

A busy Mac answers launchctl and the health check slowly; that is "unknown", not
"stopped", so the Home Compute Bar app does not offer to start what is running.

    .venv/bin/python -m unittest deploy/home-compute/test_panel.py
"""
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parent))
import panel  # noqa: E402


def finished(returncode, stdout=""):
    return subprocess.CompletedProcess([], returncode, stdout=stdout, stderr="")


def launchctl(answer):
    """subprocess.run as launchctl: `answer` is an exit status or an exception to raise."""
    def run(command, **options):
        if isinstance(answer, BaseException):
            raise answer
        return finished(answer)
    return run


class Healthy:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *exception):
        return False


class ControllerStateTest(unittest.TestCase):
    def state(self, launchd, health):
        """The controller's state with launchctl and the health request stubbed."""
        with mock.patch.object(panel.subprocess, "run", side_effect=launchctl(launchd)), \
                mock.patch.object(panel, "read_env", return_value={}), \
                mock.patch.object(panel.urllib.request, "urlopen", side_effect=health) as urlopen:
            answer = panel.controller_state()
        self.assertEqual(urlopen.call_args.kwargs["timeout"], panel.PROBE_TIMEOUT)
        return answer

    def test_not_loaded_is_stopped(self):
        refused = urllib.error.URLError(ConnectionRefusedError(61, "Connection refused"))
        answer = self.state(panel.LAUNCHCTL_NOT_FOUND, refused)
        self.assertEqual(answer, {"state": "stopped", "loaded": False, "answering": False})

    def test_loaded_and_healthy_is_running(self):
        answer = self.state(0, lambda *arguments, **options: Healthy())
        self.assertEqual(answer, {"state": "running", "loaded": True, "answering": True})

    def test_loaded_but_the_health_check_timing_out_is_unknown(self):
        answer = self.state(0, TimeoutError("timed out"))
        self.assertEqual(answer, {"state": "unknown", "loaded": True, "answering": False})
        answer = self.state(0, urllib.error.URLError(TimeoutError("timed out")))
        self.assertEqual(answer["state"], "unknown")

    def test_loaded_but_refusing_connections_is_starting(self):
        refused = urllib.error.URLError(ConnectionRefusedError(61, "Connection refused"))
        self.assertEqual(self.state(0, refused)["state"], "starting")

    def test_launchctl_timing_out_is_unknown_not_stopped(self):
        timeout = subprocess.TimeoutExpired(["launchctl"], panel.PROBE_TIMEOUT)
        answer = self.state(timeout, TimeoutError("timed out"))
        self.assertEqual(answer, {"state": "unknown", "loaded": None, "answering": False})

    def test_launchctl_failing_otherwise_is_unknown_not_stopped(self):
        refused = urllib.error.URLError(ConnectionRefusedError(61, "Connection refused"))
        self.assertEqual(self.state(112, refused)["state"], "unknown")

    def test_answering_wins_even_if_launchctl_cannot_be_asked(self):
        timeout = subprocess.TimeoutExpired(["launchctl"], panel.PROBE_TIMEOUT)
        self.assertEqual(self.state(timeout, lambda *arguments, **options: Healthy())["state"], "running")


class BacalhauStateTest(unittest.TestCase):
    def state(self, launchd, node_list):
        """Bacalhau's state; `node_list` is the CLI's exit status and output, or an exception."""
        def run(command, **options):
            if command[0] == "launchctl":
                return launchctl(launchd)(command)
            self.assertEqual(options["timeout"], panel.PROBE_TIMEOUT)
            if isinstance(node_list, BaseException):
                raise node_list
            return finished(*node_list)
        with mock.patch.object(panel.subprocess, "run", side_effect=run), \
                mock.patch.object(panel.Path, "exists", return_value=True):
            return panel.bacalhau_state()

    def test_not_loaded_is_stopped(self):
        answer = self.state(panel.LAUNCHCTL_NOT_FOUND, (1, ""))
        self.assertEqual(answer, {"state": "stopped", "loaded": False, "nodes": None})

    def test_loaded_and_answering_is_running_with_its_nodes(self):
        nodes = '[{"Connection": "CONNECTED"}, {"Connection": "DISCONNECTED"}]'
        self.assertEqual(self.state(0, (0, nodes)), {"state": "running", "loaded": True, "nodes": 1})

    def test_loaded_but_the_cli_timing_out_is_unknown(self):
        answer = self.state(0, subprocess.TimeoutExpired(["bacalhau"], panel.PROBE_TIMEOUT))
        self.assertEqual(answer, {"state": "unknown", "loaded": True, "nodes": None})

    def test_loaded_but_not_reachable_is_starting(self):
        self.assertEqual(self.state(0, (1, ""))["state"], "starting")

    def test_launchctl_timing_out_is_unknown_not_stopped(self):
        timeout = subprocess.TimeoutExpired(["launchctl"], panel.PROBE_TIMEOUT)
        self.assertEqual(self.state(timeout, (1, ""))["state"], "unknown")


class ColimaStateTest(unittest.TestCase):
    def state(self, colima_list):
        def run(command, **options):
            if command[0] == "launchctl":
                return finished(0, "")
            if isinstance(colima_list, BaseException):
                raise colima_list
            return finished(*colima_list)
        with mock.patch.object(panel.shutil, "which", return_value="/opt/homebrew/bin/colima"), \
                mock.patch.object(panel.subprocess, "run", side_effect=run):
            return panel.colima_state()

    def test_a_running_profile_is_running(self):
        answer = self.state((0, '{"name": "home-compute", "status": "Running", "cpus": 4, "memory": 8589934592}\n'))
        self.assertEqual(answer, {"state": "running", "cpus": 4, "memoryGiB": 8.0, "autostart": True})

    def test_a_stopped_profile_is_stopped(self):
        self.assertEqual(self.state((0, '{"name": "home-compute", "status": "Stopped"}\n'))["state"], "stopped")

    def test_only_the_jobs_profile_counts(self):
        listed = ('{"name": "default", "status": "Running", "cpus": 8}\n'
                  '{"name": "home-compute", "status": "Stopped", "cpus": 2}\n')
        answer = self.state((0, listed))
        self.assertEqual((answer["state"], answer["cpus"]), ("stopped", 2))

    def test_no_profile_yet_is_stopped(self):
        self.assertEqual(self.state((0, ""))["state"], "stopped")

    def test_colima_list_timing_out_is_unknown(self):
        answer = self.state(subprocess.TimeoutExpired(["colima"], 10))
        self.assertEqual(answer["state"], "unknown")


if __name__ == "__main__":
    unittest.main()
