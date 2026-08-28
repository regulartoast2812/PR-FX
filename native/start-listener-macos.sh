#!/bin/zsh
set -u

SCRIPT_DIR="${0:A:h}"
LISTENER_APP="$SCRIPT_DIR/build/PR FX Shortcut Listener.app"
LISTENER_BINARY="$LISTENER_APP/Contents/MacOS/PRFXShortcutListener"
BUILD_LOCK="$SCRIPT_DIR/build/.listener-build.lock"
HEALTH_URL="http://127.0.0.1:27389/health"
LOG_FILE="/tmp/prfx-listener-launcher.log"

log_message() {
  print -r -- "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" >> "$LOG_FILE"
}

health_ok() {
  /usr/bin/curl -fsS --max-time 0.5 "$HEALTH_URL" >/dev/null 2>&1
}

wait_for_health() {
  local attempt
  for attempt in {1..25}; do
    if health_ok; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

wait_for_build_to_finish() {
  local attempt
  for attempt in {1..80}; do
    [[ ! -f "$BUILD_LOCK" ]] && return 0
    sleep 0.1
  done
  log_message "Listener build lock is still present; refusing to launch a half-installed app."
  echo "PR FX Shortcut Listener is still building. Try again in a moment." >&2
  exit 1
}

wait_for_build_to_finish

if health_ok; then
  log_message "Listener health already OK."
  exit 0
fi

if [[ ! -d "$LISTENER_APP" ]]; then
  log_message "Listener app missing: $LISTENER_APP"
  echo "PR FX Shortcut Listener app is missing. Use Install / Repair first." >&2
  exit 1
fi

log_message "Launching listener through LaunchServices: $LISTENER_APP"
if /usr/bin/open -gj "$LISTENER_APP" >> "$LOG_FILE" 2>&1; then
  if wait_for_health; then
    log_message "Listener health OK after LaunchServices launch."
    exit 0
  fi
  log_message "LaunchServices returned success, but health did not become ready."
else
  log_message "LaunchServices failed to open listener."
fi

if wait_for_health; then
  log_message "Listener health OK after delayed LaunchServices startup."
  exit 0
fi

if [[ -x "$LISTENER_BINARY" ]]; then
  log_message "Launching listener binary directly as fallback: $LISTENER_BINARY"
  "$LISTENER_BINARY" >> "$LOG_FILE" 2>&1 &
  if wait_for_health; then
    log_message "Listener health OK after direct binary fallback."
    exit 0
  fi
  log_message "Direct binary fallback started, but health did not become ready."
else
  log_message "Listener binary missing or not executable: $LISTENER_BINARY"
fi

if health_ok; then
  exit 0
fi

log_message "Listener launched, but health did not become ready."
echo "PR FX Shortcut Listener launched, but its local bridge did not answer." >&2
exit 1
