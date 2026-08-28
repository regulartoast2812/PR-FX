#!/bin/zsh
set -u

SCRIPT_DIR="${0:A:h}"
LISTENER_APP="$SCRIPT_DIR/build/PR FX Shortcut Listener.app"
LISTENER_BUILD_FILE="$SCRIPT_DIR/build/listener-build.txt"
BUILD_LOCK="$SCRIPT_DIR/build/.listener-build.lock"
START_LISTENER="$SCRIPT_DIR/start-listener-macos.sh"
STOP_LISTENER="$SCRIPT_DIR/stop-listener-macos.sh"
HEALTH_URL="http://127.0.0.1:27389/health"
LOG_FILE="/tmp/prfx-listener-launcher.log"

log_message() {
  print -r -- "$(date -u '+%Y-%m-%dT%H:%M:%SZ') watcher: $*" >> "$LOG_FILE"
}

expected_listener_build() {
  [[ -f "$LISTENER_BUILD_FILE" ]] || return 1
  local build
  build="$(tr -d '\r\n' < "$LISTENER_BUILD_FILE" 2>/dev/null || true)"
  [[ -n "$build" ]] || return 1
  print -r -- "$build"
}

listener_health() {
  /usr/bin/curl -fsS --max-time 0.6 "$HEALTH_URL" 2>/dev/null || true
}

listener_matches_installed_build() {
  local expected health
  expected="$(expected_listener_build)" || return 0
  health="$(listener_health)"
  [[ -n "$health" && "$health" == *"\"listenerBuild\":\"$expected\""* ]]
}

build_in_progress() {
  [[ -f "$BUILD_LOCK" ]] || return 1
  local now modified age
  now="$(date +%s)"
  modified="$(stat -f %m "$BUILD_LOCK" 2>/dev/null || print 0)"
  age=$(( now - modified ))
  if (( age >= 0 && age < 120 )); then
    return 0
  fi
  log_message "Stale listener build lock removed after ${age}s."
  rm -f "$BUILD_LOCK"
  return 1
}

restart_listener() {
  /bin/zsh "$STOP_LISTENER"
  sleep 0.3
  [[ -d "$LISTENER_APP" ]] && /bin/zsh "$START_LISTENER"
}

while true; do
  if build_in_progress; then
    sleep 2
    continue
  fi
  if [[ -d "$LISTENER_APP" ]]; then
    if ! listener_matches_installed_build; then
      log_message "Listener health is missing or stale; restarting current app bundle."
      restart_listener
    elif [[ -z "$(listener_health)" ]]; then
      log_message "Listener health is offline; starting current app bundle."
      /bin/zsh "$START_LISTENER"
    fi
  fi
  sleep 2
done
