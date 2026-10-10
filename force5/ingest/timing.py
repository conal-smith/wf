"""Where an ingest job's time goes: finding the run, downloading, decoding, writing.

Every adapter runs in a process of its own under worker.py, so one recorder per
process is enough. An adapter moves through its stages with `start()` — or wraps
a block in `phase()` — and the shared helpers mark themselves: the HTTP helpers
call `request()` once per response, so transfers count towards whichever phase is
open at the time, from any thread; `decode_handle` is "decode"; `publish_frame`
and `write_json` are "write". The names the worker and
docs/LIVE_FORECAST_PIPELINE.md expect are `discover` (finding the run),
`download`, `decode` (decode, crop, validate and sample spots) and `write`; an
adapter may add others, which are reported after those.

Phases on the main thread nest, and their time is exclusive: entering an inner
phase pauses the outer one, so a frame written in the middle of the decode loop
is write time, not decode time, and the main-thread phases add up to the job. A
phase on a worker thread cannot be exclusive, because it runs alongside whatever
the main thread is waiting for, so its time is summed across threads as
`threadSeconds` and reported against the main-thread phase it ran inside
(`within`): a GFS step decoded inside its download pool is "decode, 9 s across
download workers", which is what tells a slow network from a slow decoder.

The record is written to the file the worker names in FORCE5_TIMINGS_FILE when a
stage ends (at most every few seconds), every half minute while requests keep
arriving, and by `finish()`, so a job that fails or is killed by its timeout
part-way still says how far it got. `finish()` also prints the one-line summary.
Nothing here touches what an adapter publishes.
"""
from contextlib import contextmanager
import functools
import json
import os
from pathlib import Path
import threading
import time

TIMINGS_ENV = "FORCE5_TIMINGS_FILE"
# Under the work directory: the worker keeps each model's last job event here as
# `<model>.json` for status.py, beside the raw cache so that it ages out with it.
JOBS_DIRECTORY = Path(".cache") / "jobs"
# Reported in this order; any other phase follows them in the order first seen.
ORDER = ("discover", "index", "download", "decode", "write", "validate", "publish")
SAVE_EVERY = 5.0  # Seconds between record writes while stages keep ending.
HEARTBEAT = 30.0  # Seconds between record writes while one stage keeps downloading.


class Timings:
    """Per-phase wall time and transfer counts for one process."""

    def __init__(self, path=None, clock=time.monotonic):
        self.clock, self.path = clock, Path(path) if path else None
        self.started = clock()
        self.lock, self.writing = threading.Lock(), threading.Lock()
        self.phases = {}
        self.stack = []  # [name, since, stage] for each open main-thread phase.
        self.saved = None

    def _entry(self, name):
        return self.phases.setdefault(name, {"seconds": 0.0})

    def _open(self, name, workers, stage):
        """Push a main-thread phase, pausing the one beneath it. Caller holds the lock."""
        now = self.clock()
        entry = self._entry(name)
        if workers:
            entry["workers"] = max(entry.get("workers", 0), int(workers))
        if self.stack:
            self._entry(self.stack[-1][0])["seconds"] += now - self.stack[-1][1]
        frame = [name, now, stage]
        self.stack.append(frame)
        return frame

    def _close(self, frame):
        """Pop exactly this phase and resume the one beneath it. Caller holds the lock."""
        now = self.clock()
        if not self.stack or self.stack[-1] is not frame:
            # Paused beneath another phase, so its time is already counted.
            self.stack = [open_ for open_ in self.stack if open_ is not frame]
            return now
        self._entry(frame[0])["seconds"] += now - frame[1]
        self.stack.pop()
        if self.stack:
            self.stack[-1][1] = now
        return now

    @contextmanager
    def phase(self, name, workers=None):
        """Time a block; `workers` is the concurrency it ran with."""
        if threading.current_thread() is not threading.main_thread():
            started = self.clock()
            try:
                yield
            finally:
                elapsed = self.clock() - started
                with self.lock:
                    entry = self._entry(name)
                    entry["threadSeconds"] = entry.get("threadSeconds", 0.0) + elapsed
                    if self.stack and self.stack[-1][0] != name:
                        entry.setdefault("within", self.stack[-1][0])
            return
        with self.lock:
            frame = self._open(name, workers, False)
        try:
            yield
        finally:
            with self.lock:
                self._close(frame)

    def timed(self, name):
        """A decorator: every call of the function is a `name` phase."""
        def wrap(function):
            @functools.wraps(function)
            def timed_call(*args, **kwargs):
                with self.phase(name):
                    return function(*args, **kwargs)
            return timed_call
        return wrap

    def start(self, name, workers=None):
        """End the current stage, if any, and begin the next one."""
        self.stop()
        with self.lock:
            self._open(name, workers, True)

    def stop(self):
        """End the current stage. Phases still open above it are left alone."""
        with self.lock:
            stages = [frame for frame in self.stack if frame[2]]
            if not stages:
                return
            now = self._close(stages[-1])
            due = self.saved is None or now - self.saved >= SAVE_EVERY
        if due:
            self.save()

    def _count(self, field, amount=1):
        with self.lock:
            entry = self._entry(self.stack[-1][0] if self.stack else "other")
            entry[field] = entry.get(field, 0) + amount

    def request(self, size=0):
        """One completed request and the bytes it brought back, from any thread.

        Also the heartbeat of a long download: the record is rewritten every
        HEARTBEAT seconds, so a job killed by its timeout still shows how far its
        download had got."""
        with self.lock:
            entry = self._entry(self.stack[-1][0] if self.stack else "other")
            entry["requests"] = entry.get("requests", 0) + 1
            entry["bytes"] = entry.get("bytes", 0) + int(size or 0)
            due = self.saved is None or self.clock() - self.saved >= HEARTBEAT
        if due:
            self.save()

    def received(self, size):
        """Bytes that arrived without being counted by `request`."""
        self._count("bytes", int(size or 0))

    def retry(self):
        """A failed attempt that is about to be tried again."""
        self._count("retries")

    def failure(self):
        """A request that was given up on."""
        self._count("failures")

    def record(self):
        """The phases so far, the running one included, rounded for a log line."""
        with self.lock:
            now = self.clock()
            phases = {name: dict(entry) for name, entry in self.phases.items()}
            if self.stack:
                top, since = self.stack[-1][:2]
                phases[top]["seconds"] += now - since
            total = now - self.started
        ordered = {}
        for name in [*ORDER, *phases]:
            if name in phases and name not in ordered:
                ordered[name] = {key: (round(value, 1) if key.endswith("econds") else value)
                                 for key, value in phases[name].items()
                                 if value or key == "seconds"}
        return {"seconds": round(total, 1), "phases": ordered}

    def save(self):
        """Write the record where the worker will look for it; never fail the job.

        Any thread may call this, so one writer at a time; a thread that finds
        another already writing leaves it to that one."""
        self.saved = self.clock()
        if not self.path or not self.writing.acquire(blocking=False):
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(json.dumps(self.record()))
            os.replace(temporary, self.path)
        except OSError:
            pass
        finally:
            self.writing.release()

    def finish(self, label="Timing"):
        """End the last stage, print the one-line summary and write the record."""
        self.stop()
        self.save()
        print(f"{label}: {summary(self.record())}", flush=True)


def count_responses(session):
    """Count every response a `requests` session receives. Only for a session that
    never streams: the hook reads the body to measure it."""
    def hook(response, *args, **kwargs):
        if response.status_code == 429 or response.status_code >= 500:
            TIMINGS.retry()
        TIMINGS.request(len(response.content))
    session.hooks["response"].append(hook)
    return session


def duration(seconds):
    return f"{seconds:.1f} s" if seconds < 10 else f"{seconds:,.0f} s"


def size(count):
    for unit, scale in (("GB", 1e9), ("MB", 1e6), ("kB", 1e3)):
        if count >= scale:
            return f"{count / scale:.1f} {unit}"
    return f"{count} B"


def summary(record):
    """`download 1,890 s (1,271 req, 18.7 MB, 2 at a time) · decode 41 s · write 3.0 s`."""
    parts = []
    for name, entry in record.get("phases", {}).items():
        seconds, threads = entry.get("seconds", 0), entry.get("threadSeconds")
        if seconds < 0.05 and not threads and not entry.get("requests"):
            continue
        details = []
        if entry.get("requests"):
            details.append(f"{entry['requests']:,} req")
        if entry.get("bytes"):
            details.append(size(entry["bytes"]))
        if entry.get("workers"):
            details.append(f"{entry['workers']} at a time")
        for key, word in (("retries", "retried"), ("failures", "failed")):
            if entry.get(key):
                details.append(f"{entry[key]:,} {word}")
        if threads:
            where = f"{entry['within']} workers" if entry.get("within") else "workers"
            details.append(f"+{duration(threads)} across {where}")
        text = f"{name} {duration(seconds)}"
        parts.append(text + (f" ({', '.join(details)})" if details else ""))
    parts.append(f"total {duration(record.get('seconds', 0))}")
    return " · ".join(parts)


# The process's one recorder, and its methods as module functions for the adapters.
TIMINGS = Timings(os.environ.get(TIMINGS_ENV))
phase, timed, start, stop, finish = (TIMINGS.phase, TIMINGS.timed, TIMINGS.start,
                                     TIMINGS.stop, TIMINGS.finish)
request, received, retry, failure = (TIMINGS.request, TIMINGS.received, TIMINGS.retry,
                                     TIMINGS.failure)
