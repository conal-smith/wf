#!/bin/bash
# Run the forecast on this Mac through Home Compute: Bacalhau runs the worker
# image in Colima's Docker, Home Compute submits it on deploy/local/jobs.toml's
# timetable, and each run publishes to the R2 bucket in deploy/home-compute/.env.
#
#   deploy/home-compute/macmini.sh setup    # once: image, .env, token, launch agents
#   deploy/home-compute/macmini.sh start    # load both launch agents (runs at login too)
#   deploy/home-compute/macmini.sh stop     # unload them; a running import finishes
#   deploy/home-compute/macmini.sh status   # services, Bacalhau's node, every job
#   deploy/home-compute/macmini.sh run JOB  # submit one job now, e.g. harmonie
#   deploy/home-compute/macmini.sh logs     # follow the controller's log
#   deploy/home-compute/macmini.sh image    # rebuild the worker image after a code change
#   deploy/home-compute/macmini.sh pull [REF]   # run a released image instead (default: :production)
#   deploy/home-compute/macmini.sh restart controller   # only the scheduler, to apply a change
#   deploy/home-compute/macmini.sh colima-autostart on|off
#
# For the Home Compute Bar app, each printing one JSON object (see panel.py):
#   state | env | env set NAME (value on stdin) | r2-test | token rotate
#   jobs | jobs set JOB [--enabled true|false] [--hours every|3,9] [--minutes 30] [--memory 4Gb]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WINGFOIL="$(cd "$HERE/../.." && pwd)"
HOME_COMPUTE="${HOME_COMPUTE_DIR:-$(cd "$WINGFOIL/.." && pwd)/home-compute}"
CONFIG="$HERE/home-compute.json"
ENV_FILE="$HERE/.env"
IMAGE="wingfoil-forecast:local"
# What a release promotes to production (docs/RELEASES.md); `pull` fetches it.
RELEASED_IMAGE="${WINGFOIL_RELEASED_IMAGE:-ghcr.io/sprintengine/wingfoil-forecast:production}"
BIN="$HOME/.local/bin"
LOGS="$HOME/Library/Logs/home-compute"
AGENTS="$HOME/Library/LaunchAgents"
BACALHAU_LABEL="dev.sprintengine.bacalhau"
CONTROLLER_LABEL="dev.sprintengine.home-compute"
export PATH="$BIN:/opt/homebrew/bin:/usr/local/bin:$PATH"
PYTHON="$WINGFOIL/.venv/bin/python"
panel() { "$PYTHON" -I "$HERE/panel.py" "$@"; }
schedules() { "$PYTHON" -I "$WINGFOIL/deploy/schedules.py" "$@"; }

# Colima's VM is what Docker containers actually get, not the Mac's own memory,
# so Bacalhau is told the VM's size less a margin and never overcommits it.
colima_socket() { echo "unix://$HOME/.colima/default/docker.sock"; }
vm_field() { colima list --json 2>/dev/null | python3 -c "import json,sys; print(json.loads(sys.stdin.readline())['$1'])"; }

say() { printf '\033[1m%s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "Missing $1. $2" >&2; exit 1; }; }

ensure_colima() {
  need colima "Install it with: brew install colima"
  if ! colima status >/dev/null 2>&1; then
    say "Starting Colima"
    colima start
  fi
}

build_image() {
  ensure_colima
  say "Building $IMAGE from force5/Dockerfile"
  # The label is what lets the app say the image is older than the code.
  DOCKER_HOST="$(colima_socket)" docker build -f "$WINGFOIL/force5/Dockerfile" -t "$IMAGE" \
    --label "wingfoil.source-hash=$(panel source-hash)" "$WINGFOIL"
}

# A released image instead of one built here: the exact digest a release ran
# through acceptance and staging. Tagged as the local image, so Home Compute and
# the app need nothing changed; the label it was built with still says whether
# it matches this checkout.
pull_image() {
  local ref="${1:-$RELEASED_IMAGE}"
  ensure_colima
  say "Pulling $ref"
  DOCKER_HOST="$(colima_socket)" docker pull "$ref"
  DOCKER_HOST="$(colima_socket)" docker tag "$ref" "$IMAGE"
  DOCKER_HOST="$(colima_socket)" docker image inspect "$IMAGE" \
    --format "$IMAGE is now {{index .RepoDigests 0}} ({{index .Config.Labels \"org.opencontainers.image.version\"}})"
}

write_env() {
  if [ -f "$ENV_FILE" ]; then
    say "Keeping existing $ENV_FILE"
    return
  fi
  if [ ! -f "$WINGFOIL/r2.env" ]; then
    # No bucket to copy: start from the defaults and a token; the app's Storage tab fills the rest.
    panel env >/dev/null && printf '' | panel env set S3_PREFIX >/dev/null
    say "Wrote $ENV_FILE without a bucket: add the R2 settings in the app's Storage tab"
    return
  fi
  say "Writing $ENV_FILE from r2.env"
  ( umask 077
    {
      echo "# Read by Home Compute. Values are passed to each job; keep this file private."
      echo "WINGFOIL_IMAGE=$IMAGE"
      grep -E '^(S3_BUCKET|S3_ENDPOINT_URL|S3_PREFIX|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=' "$WINGFOIL/r2.env"
      echo "AWS_REGION=auto"
      echo "FORCE5_SIDECARS=0"
      echo "ECMWF_SOURCE=ecmwf"
      echo "HOME_COMPUTE_API_TOKEN=$(openssl rand -hex 24)"
    } > "$ENV_FILE" )
}

env_value() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

write_menubar_config() {
  panel menubar-config >/dev/null
  say "Wrote ~/.config/home-compute/menubar.json for the menu bar app"
}

write_agents() {
  need bacalhau "Install it: BACALHAU_INSTALL_DIR=\$HOME/.local/bin bash <(curl -sL https://get.bacalhau.org/install.sh)"
  need node "Install Node 22 or newer"
  mkdir -p "$AGENTS" "$LOGS"
  local cpus memory
  cpus="$(vm_field cpus)"
  # GiB to the VM, a half GiB left to Docker and the kernel.
  memory="$(python3 -c "print(f'{int($(vm_field memory)) / 2**30 - 0.5:g}Gb')")"
  cat > "$AGENTS/$BACALHAU_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$BACALHAU_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$BIN/bacalhau</string><string>serve</string><string>--orchestrator</string><string>--compute</string>
    <string>-c</string><string>API.Host=127.0.0.1</string>
    <string>-c</string><string>API.Port=1234</string>
    <string>-c</string><string>Orchestrator.Host=127.0.0.1</string>
    <string>-c</string><string>Compute.AllocatedCapacity.CPU=$cpus</string>
    <string>-c</string><string>Compute.AllocatedCapacity.Memory=$memory</string>
    <string>-c</string><string>Compute.AllocatedCapacity.Disk=30Gb</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>DOCKER_HOST</key><string>$(colima_socket)</string>
    <key>PATH</key><string>$BIN:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOGS/bacalhau.log</string>
  <key>StandardErrorPath</key><string>$LOGS/bacalhau.log</string>
</dict></plist>
PLIST
  cat > "$AGENTS/$CONTROLLER_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$CONTROLLER_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$(command -v node)</string><string>$HOME_COMPUTE/src/cli.mjs</string>
    <string>daemon</string><string>--config</string><string>$CONFIG</string>
  </array>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$BIN:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOGS/controller.log</string>
  <key>StandardErrorPath</key><string>$LOGS/controller.log</string>
</dict></plist>
PLIST
  say "Wrote launch agents to $AGENTS (Bacalhau gets $cpus CPUs, $memory)"
}

loaded() { launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1; }

start() {
  ensure_colima
  for label in "$BACALHAU_LABEL" "$CONTROLLER_LABEL"; do
    [ -f "$AGENTS/$label.plist" ] || { echo "Run setup first" >&2; exit 1; }
    loaded "$label" || launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
    say "Started $label"
    # The controller asks Bacalhau for its nodes at once; give the node a moment.
    [ "$label" = "$BACALHAU_LABEL" ] && sleep 5
  done
  echo "Logs: $LOGS"
}

stop() {
  for label in "$CONTROLLER_LABEL" "$BACALHAU_LABEL"; do
    if loaded "$label"; then launchctl bootout "gui/$(id -u)/$label" && say "Stopped $label"; fi
  done
}

controller() { node "$HOME_COMPUTE/src/cli.mjs" "$@" --config "$CONFIG"; }

status() {
  for label in "$BACALHAU_LABEL" "$CONTROLLER_LABEL"; do
    if loaded "$label"; then echo "$label: running"; else echo "$label: stopped"; fi
  done
  bacalhau node list --api-host 127.0.0.1 --api-port 1234 2>/dev/null || echo "Bacalhau is not answering"
  local token
  token="$(env_value HOME_COMPUTE_API_TOKEN)"
  curl -fsS -H "Authorization: Bearer $token" "http://127.0.0.1:4786/v1/snapshot?live=false" 2>/dev/null | python3 -c '
import json, sys
snapshot = json.load(sys.stdin)
print(f"{\"job\":<16} {\"state\":<10} {\"next (UTC)\":<17} {\"last\":<10} published")
for job in snapshot["jobs"]:
    state = "running" if job.get("running") else ("paused" if job.get("paused") else ("off" if not job.get("enabled") else "idle"))
    upcoming = (job.get("nextDueAt") or "")[5:16].replace("T", " ")
    published = ", ".join(f"{model} {entry.get(\"run\")}" for model, entry in (job.get("published") or {}).items())
    print(f"{job[\"id\"]:<16} {state:<10} {upcoming:<17} {job.get(\"lastOutcome\") or \"-\":<10} {published}")
' || echo "The controller is not answering on 127.0.0.1:4786"
}

# The app asks for `state --json`; every panel command answers in JSON anyway.
args=()
for arg in "$@"; do [ "$arg" = "--json" ] || args+=("$arg"); done
set -- "${args[@]+"${args[@]}"}"

case "${1:-help}" in
  setup)
    schedules --check
    [ -d "$HOME_COMPUTE/node_modules" ] || (cd "$HOME_COMPUTE" && npm ci)
    [ "${SKIP_IMAGE:-}" = 1 ] || build_image
    write_env
    write_menubar_config
    write_agents
    controller validate
    controller doctor || true
    say "Ready. Start it with: $0 start"
    ;;
  start) start ;;
  stop) stop ;;
  restart)
    if [ "${2:-}" = controller ]; then
      # Applies a new timetable, .env or token: the daemon reads them at start.
      loaded "$CONTROLLER_LABEL" || { echo "The scheduler is not running" >&2; exit 1; }
      launchctl kickstart -k "gui/$(id -u)/$CONTROLLER_LABEL" && say "Restarted $CONTROLLER_LABEL"
    else
      stop; start
    fi ;;
  colima-autostart)
    case "${2:-}" in
      on) brew services start colima ;;
      off) brew services stop colima ;;
      *) echo "Usage: $0 colima-autostart on|off" >&2; exit 1 ;;
    esac ;;
  state|env|r2-test|token|source-hash) panel "$@" ;;
  jobs)
    if [ "${2:-}" = set ]; then
      [ $# -ge 3 ] || { echo '{"ok": false, "error": "Usage: jobs set JOB [--enabled ...]"}'; exit 2; }
      job="$3"; shift 3
      schedules --set "$job" "$@"
    else
      schedules --list
    fi ;;
  status) status ;;
  run) shift; [ $# -ge 1 ] || { echo "Usage: $0 run JOB" >&2; exit 1; }
       token="$(env_value HOME_COMPUTE_API_TOKEN)"
       curl -fsS -X POST -H "Authorization: Bearer $token" -H 'content-type: application/json' \
         -d '{}' "http://127.0.0.1:4786/v1/jobs/$1/run" && echo ;;
  logs) tail -n 50 -F "$LOGS/controller.log" ;;
  image) build_image ;;
  pull) pull_image "${2:-}" ;;
  *) sed -n '2,/^set -euo/{/^#/p;}' "$0" | sed 's/^# \{0,1\}//' ;;
esac
