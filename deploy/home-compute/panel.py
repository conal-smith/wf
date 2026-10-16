"""The machine-readable half of macmini.sh, for the Home Compute Bar app.

Every command prints one JSON object. Exit 0 is an answer, exit 2 a refusal
with {"ok": false, "error": ...}. Secrets are read from stdin, never argv, and
are never printed back: `env` says only whether each is set, with the last four
characters of the access key id as a hint.

    panel.py state           services, setup and the worker image
    panel.py env             the .env's settings
    panel.py env set NAME    one setting, its value on stdin
    panel.py r2-test         reach the bucket and read every model's manifest
    panel.py token rotate    a new API token, in .env and the app's config
    panel.py source-hash     what the worker image is built from, hashed

Run by macmini.sh with the repository's .venv Python, which has boto3.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
WINGFOIL = HERE.parents[1]
HOME_COMPUTE = Path(os.environ.get("HOME_COMPUTE_DIR", WINGFOIL.parent / "home-compute"))
ENV_FILE = HERE / ".env"
CONFIG = HERE / "home-compute.json"
JOBS_FILE = WINGFOIL / "deploy" / "local" / "jobs.toml"
HOME = Path.home()
BIN = HOME / ".local" / "bin"
LOGS = HOME / "Library" / "Logs" / "home-compute"
AGENTS = HOME / "Library" / "LaunchAgents"
MENUBAR_CONFIG = HOME / ".config" / "home-compute" / "menubar.json"
BACALHAU_LABEL = "dev.sprintengine.bacalhau"
CONTROLLER_LABEL = "dev.sprintengine.home-compute"
VM_LABEL = "dev.sprintengine.home-compute-vm"
IMAGE = "wingfoil-forecast:local"
SOURCE_LABEL = "wingfoil.source-hash"
# The jobs' own Colima VM, in home-compute-vm/ beside the checkout (macmini.sh).
COLIMA_HOME = Path(os.environ.get("HOME_COMPUTE_VM_DIR", WINGFOIL.parent / "home-compute-vm"))
COLIMA_PROFILE = "home-compute"
DOCKER_HOST = f"unix://{COLIMA_HOME}/{COLIMA_PROFILE}/docker.sock"
PATH = f"{BIN}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

SETTINGS = ["S3_BUCKET", "S3_ENDPOINT_URL", "S3_PREFIX", "AWS_REGION", "ECMWF_SOURCE",
            "WINGFOIL_IMAGE", "FORCE5_SIDECARS"]
SECRETS = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "HOME_COMPUTE_API_TOKEN"]
EDITABLE = ["S3_BUCKET", "S3_ENDPOINT_URL", "S3_PREFIX", "AWS_REGION", "ECMWF_SOURCE",
            "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]
REQUIRED = ["S3_BUCKET", "S3_ENDPOINT_URL", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]
# What a new .env starts with when there is no r2.env to copy the bucket from.
DEFAULTS = {"WINGFOIL_IMAGE": IMAGE, "AWS_REGION": "auto", "FORCE5_SIDECARS": "0",
            "ECMWF_SOURCE": "ecmwf"}


class Refusal(Exception):
    """A request the panel will not carry out; exit 2 with the reason."""


def run(*command, timeout=10, **options):
    environment = {**os.environ, "PATH": PATH, "DOCKER_HOST": DOCKER_HOST,
                   "COLIMA_HOME": str(COLIMA_HOME)}
    try:
        return subprocess.run(command, capture_output=True, text=True, timeout=timeout,
                              env=environment, **options)
    except (OSError, subprocess.TimeoutExpired):
        return None


# --- the .env -----------------------------------------------------------------

def read_env():
    values = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                name, value = line.split("=", 1)
                values[name.strip()] = value.strip()
    return values


def write_env(values):
    """Rewrite the .env with `values`, keeping its comments and order, privately."""
    lines = ENV_FILE.read_text().splitlines() if ENV_FILE.exists() else [
        "# Read by Home Compute. Values are passed to each job; keep this file private."]
    remaining = dict(values)
    for index, line in enumerate(lines):
        name = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else None
        if name in remaining:
            lines[index] = f"{name}={remaining.pop(name)}"
    lines += [f"{name}={value}" for name, value in remaining.items()]
    temporary = ENV_FILE.with_suffix(".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        handle.write("\n".join(lines) + "\n")
    os.replace(temporary, ENV_FILE)


def ensure_env():
    """A .env to edit: the defaults and a fresh token if there is none yet."""
    if not ENV_FILE.exists():
        write_env({**DEFAULTS, "HOME_COMPUTE_API_TOKEN": secrets.token_hex(24)})
    return read_env()


def env_answer():
    values = read_env()
    hint = values.get("AWS_ACCESS_KEY_ID", "")
    return {
        "exists": ENV_FILE.exists(),
        "values": {name: values.get(name, DEFAULTS.get(name, "")) for name in SETTINGS},
        "secrets": {name: {"set": bool(values.get(name)),
                           "hint": f"…{hint[-4:]}" if name == "AWS_ACCESS_KEY_ID" and len(hint) >= 4 else None}
                    for name in SECRETS},
    }


def env_set(name):
    if name not in EDITABLE:
        raise Refusal(f"{name} cannot be set here; editable: {', '.join(EDITABLE)}")
    value = sys.stdin.readline().strip()
    if "\n" in value or "\r" in value:
        raise Refusal("A value is one line")
    if name in REQUIRED and not value:
        raise Refusal(f"{name} is required")
    if name == "S3_ENDPOINT_URL" and value and not value.startswith("https://"):
        raise Refusal("The endpoint is an https:// URL, e.g. https://ACCOUNT.r2.cloudflarestorage.com")
    ensure_env()
    write_env({name: value})
    return {"ok": True, "restartRequired": True}


def merge_menubar(**changes):
    """Update the app's config without losing the keys the app itself keeps there."""
    MENUBAR_CONFIG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        current = json.loads(MENUBAR_CONFIG.read_text())
    except (OSError, ValueError):
        current = {}
    current.update(changes)
    descriptor = os.open(MENUBAR_CONFIG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        handle.write(json.dumps(current, indent=2) + "\n")


def token_rotate():
    token = secrets.token_hex(24)
    ensure_env()
    write_env({"HOME_COMPUTE_API_TOKEN": token})
    merge_menubar(token=token)
    return {"ok": True, "restartRequired": True}


# --- R2 -------------------------------------------------------------------------

def r2_test():
    values = read_env()
    answer = {"ok": False, "bucket": values.get("S3_BUCKET", ""), "endpoint": values.get("S3_ENDPOINT_URL", ""),
              "objectsSeen": 0, "manifests": [], "error": None}
    missing = [name for name in REQUIRED if not values.get(name)]
    if missing:
        answer["error"] = f"Not set: {', '.join(missing)}"
        return answer
    sys.path.insert(0, str(WINGFOIL / "force5" / "ingest"))
    from registry import MANIFESTS  # noqa: E402  The models and where each publishes.
    import boto3
    from botocore.config import Config
    from botocore.exceptions import BotoCoreError, ClientError
    client = boto3.client(
        "s3", endpoint_url=values["S3_ENDPOINT_URL"], region_name=values.get("AWS_REGION") or "auto",
        aws_access_key_id=values["AWS_ACCESS_KEY_ID"], aws_secret_access_key=values["AWS_SECRET_ACCESS_KEY"],
        config=Config(retries={"max_attempts": 2}, connect_timeout=5, read_timeout=15))
    prefix = values.get("S3_PREFIX", "").strip("/")
    prefix = f"{prefix}/" if prefix else ""
    try:
        listed = client.list_objects_v2(Bucket=values["S3_BUCKET"], Prefix=prefix, MaxKeys=1)
        answer["objectsSeen"] = listed.get("KeyCount", 0)
    except (BotoCoreError, ClientError) as error:
        answer["error"] = str(error)
        return answer
    for model, key in MANIFESTS.items():
        entry = {"model": model, "key": prefix + key, "run": None, "lastModified": None, "missing": True}
        try:
            response = client.get_object(Bucket=values["S3_BUCKET"], Key=prefix + key)
            body = response["Body"].read()
            entry.update(missing=False, lastModified=response["LastModified"].astimezone(timezone.utc)
                         .isoformat().replace("+00:00", "Z"))
            entry["run"] = json.loads(body).get("run")
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") not in ("NoSuchKey", "404"):
                entry["error"] = str(error)
        except ValueError:
            entry["error"] = "Not JSON"
        answer["manifests"].append(entry)
    answer["ok"] = True
    return answer


# --- the worker image --------------------------------------------------------------

def source_hash():
    """A hash of everything force5/Dockerfile copies, so a stale image can be named.

    The Dockerfile's COPY lines, less jobs.toml: the image carries a copy for the
    Compose scheduler, but a container job never reads it, so a timetable edit
    does not make the image stale. macmini.sh labels the image with this at build
    time, and `state` compares the label with the tree's.
    """
    digest = hashlib.sha256()
    files = [WINGFOIL / "force5" / "Dockerfile",
             WINGFOIL / "public" / "spots.json", WINGFOIL / "public" / "riding-locations.json"]
    files += sorted(path for path in (WINGFOIL / "force5" / "ingest").rglob("*")
                    if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc")
    for path in files:
        digest.update(str(path.relative_to(WINGFOIL)).encode() + b"\0")
        digest.update(path.read_bytes() if path.exists() else b"")
    return digest.hexdigest()[:16]


def utc(stamp):
    """Docker's `Created` (nanoseconds, any offset) as UTC with a Z, or None."""
    match = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?(Z|[+-]\d\d:\d\d)$", stamp or "")
    if not match:
        return None
    moment = datetime.fromisoformat(match.group(1) + match.group(2).replace("Z", "+00:00"))
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def image_state():
    current = source_hash()
    answer = {"name": IMAGE, "present": False, "builtAt": None, "sourceHash": None,
              "currentHash": current, "stale": True, "sizeBytes": None}
    result = run("docker", "image", "inspect", IMAGE)
    if result and result.returncode == 0:
        details = json.loads(result.stdout)[0]
        built = (details.get("Config") or {}).get("Labels") or {}
        answer.update(present=True, builtAt=utc(details.get("Created", "")),
                      sizeBytes=details.get("Size"), sourceHash=built.get(SOURCE_LABEL))
        answer["stale"] = answer["sourceHash"] != current
    return answer


# --- services -----------------------------------------------------------------------

# How long a probe waits for launchctl or a service's API. A busy Mac (an import,
# an image build) can take several seconds to answer either; a shorter wait read
# that as "stopped" while the services had been up all along.
PROBE_TIMEOUT = 10
# `launchctl print`'s exit status for "Could not find service ... in domain".
LAUNCHCTL_NOT_FOUND = 113


def launchd_loaded(label):
    """True if launchd has the job loaded, False only when launchd says it is not,
    and None when launchctl could not be asked (it timed out or failed otherwise)."""
    result = run("launchctl", "print", f"gui/{os.getuid()}/{label}", timeout=PROBE_TIMEOUT)
    if result is None:
        return None
    if result.returncode == 0:
        return True
    return False if result.returncode == LAUNCHCTL_NOT_FOUND else None


def service_state(answering, is_loaded, refused):
    """A launchd service's state, saying "stopped" only on launchd's word.

    running   it answered
    stopped   launchd says the job is not loaded
    starting  loaded, but nothing is listening yet (the connection was refused)
    unknown   it did not answer in time, or launchctl could not be asked: a busy
              Mac, not a stopped service, so nothing should offer to start it
    """
    if answering:
        return "running"
    if is_loaded is False:
        return "stopped"
    if is_loaded and refused:
        return "starting"
    return "unknown"


def colima_state():
    if not shutil.which("colima", path=PATH):
        return {"state": "missing", "cpus": None, "memoryGiB": None, "autostart": False}
    result = run("colima", "list", "--json")
    profile = {}
    listed = bool(result and result.returncode == 0)
    if listed:
        try:
            profiles = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
            profile = next((p for p in profiles if p.get("name") == COLIMA_PROFILE), {})
        except ValueError:
            listed = False
    autostart = bool(launchd_loaded(VM_LABEL))
    state = ("running" if profile.get("status") == "Running" else "stopped") if listed else "unknown"
    return {"state": state,
            "cpus": profile.get("cpus"),
            "memoryGiB": round(profile["memory"] / 2**30, 1) if profile.get("memory") else None,
            "autostart": autostart}


def bacalhau_state():
    if not (BIN / "bacalhau").exists():
        return {"state": "missing", "loaded": False, "nodes": 0}
    is_loaded = launchd_loaded(BACALHAU_LABEL)
    nodes = None
    result = run(str(BIN / "bacalhau"), "node", "list", "--output", "json",
                 "--api-host", "127.0.0.1", "--api-port", "1234", timeout=PROBE_TIMEOUT)
    answering = bool(result and result.returncode == 0)
    if answering:
        try:
            nodes = sum(1 for node in json.loads(result.stdout) if node.get("Connection") == "CONNECTED")
        except ValueError:
            nodes = 0
    # The CLI exits non-zero at once when nothing is listening; None is a timeout.
    refused = bool(result and result.returncode != 0)
    return {"state": service_state(answering, is_loaded, refused), "loaded": is_loaded, "nodes": nodes}


def controller_state():
    is_loaded = launchd_loaded(CONTROLLER_LABEL)
    request = urllib.request.Request("http://127.0.0.1:4786/v1/health", headers={
        "Authorization": f"Bearer {read_env().get('HOME_COMPUTE_API_TOKEN', '')}"})
    refused = False
    try:
        with urllib.request.urlopen(request, timeout=PROBE_TIMEOUT) as response:
            answering = response.status == 200
    except (urllib.error.URLError, OSError) as error:
        answering = False
        refused = isinstance(getattr(error, "reason", error), ConnectionRefusedError)
    return {"state": service_state(answering, is_loaded, refused), "loaded": is_loaded, "answering": answering}


def config_current():
    result = run(sys.executable, str(WINGFOIL / "deploy" / "schedules.py"), "--check")
    return bool(result and result.returncode == 0)


def state():
    values = read_env()
    tools = {name: bool(shutil.which(name, path=PATH)) for name in ("colima", "docker", "node")}
    tools["bacalhau"] = (BIN / "bacalhau").exists()
    setup = {
        "envFile": ENV_FILE.exists(),
        "r2Configured": all(values.get(name) for name in REQUIRED),
        "agents": all((AGENTS / f"{label}.plist").exists() for label in (BACALHAU_LABEL, CONTROLLER_LABEL)),
        "homeComputeDeps": (HOME_COMPUTE / "node_modules").exists(),
        "configCurrent": config_current(),
        "tools": tools,
    }
    image = image_state()
    setup["complete"] = (all(value for key, value in setup.items() if key != "tools")
                         and all(tools.values()) and image["present"])
    return {
        "paths": {"wingfoil": str(WINGFOIL), "homeCompute": str(HOME_COMPUTE), "envFile": str(ENV_FILE),
                  "jobsFile": str(JOBS_FILE), "logs": str(LOGS),
                  "controllerLog": str(LOGS / "controller.log"), "bacalhauLog": str(LOGS / "bacalhau.log")},
        "setup": setup,
        "services": {"colima": colima_state(), "bacalhau": bacalhau_state(), "controller": controller_state()},
        "image": image,
        "checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }


def main(argv):
    command = argv[:2] if argv[:1] in (["env"], ["token"]) else argv[:1]
    try:
        if command == ["state"]:
            answer = state()
        elif command == ["env"] and len(argv) == 1:
            answer = env_answer()
        elif command == ["env", "set"] and len(argv) == 3:
            answer = env_set(argv[2])
        elif command == ["r2-test"]:
            answer = r2_test()
        elif command == ["token", "rotate"]:
            answer = token_rotate()
        elif command == ["source-hash"]:
            print(source_hash())
            return 0
        elif command == ["menubar-config"]:
            # Called by setup: the app's address, token and this panel's script.
            merge_menubar(url="http://127.0.0.1:4786", token=read_env().get("HOME_COMPUTE_API_TOKEN", ""),
                          setupScript=str(HERE / "macmini.sh"))
            answer = {"ok": True, "path": str(MENUBAR_CONFIG)}
        else:
            raise Refusal(f"Unknown command: {' '.join(argv) or '(none)'}")
    except Refusal as refusal:
        print(json.dumps({"ok": False, "error": str(refusal)}))
        return 2
    print(json.dumps(answer, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
