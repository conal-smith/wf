"""The one lock every writer of the work directory takes."""
from contextlib import contextmanager
import fcntl


@contextmanager
def workspace_lock(root):
    """Hold `.cache/worker.lock` or raise BlockingIOError; released if the process dies."""
    directory = root / ".cache"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "worker.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
