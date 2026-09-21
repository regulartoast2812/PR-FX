#!/bin/zsh
set -u

SCRIPT_DIR="${0:A:h}"
LISTENER_APP="$SCRIPT_DIR/build/PR FX Shortcut Listener.app"
LISTENER_BUILD_FILE="$SCRIPT_DIR/build/listener-build.txt"
BUILD_LOCK="$SCRIPT_DIR/build/.listener-build.lock"
START_LISTENER="$SCRIPT_DIR/start-listener-macos.sh"
STOP_LISTENER="$SCRIPT_DIR/stop-listener-macos.sh"
BRIDGE_PORT="27389"
HEALTH_URL="http://127.0.0.1:$BRIDGE_PORT/health"
LOG_FILE="/tmp/prfx-listener-launcher.log"
last_unverified_bridge_log_at=0

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

bridge_is_listening() {
  local output
  output="$(/usr/sbin/lsof -nP -iTCP:"$BRIDGE_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [[ "$output" == *"PRFXShort"* || "$output" == *"PRFXShortcutListener"* || "$output" == *"PR FX Shortcut Listener"* ]]
}

health_matches_installed_build() {
  local expected health
  health="$1"
  expected="$(expected_listener_build)" || return 0
  [[ "$health" == *"\"listenerBuild\":\"$expected\""* ]]
}

log_unverified_bridge_once() {
  local now
  now="$(date +%s)"
  if (( now - last_unverified_bridge_log_at >= 60 )); then
    log_message "Listener bridge is listening on port $BRIDGE_PORT, but health is not readable; leaving it running."
    last_unverified_bridge_log_at="$now"
  fi
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
    health="$(listener_health)"
    if [[ -n "$health" ]] && ! health_matches_installed_build "$health"; then
      log_message "Listener health is missing or stale; restarting current app bundle."
      restart_listener
    elif [[ -z "$health" ]] && bridge_is_listening; then
      log_unverified_bridge_once
    elif [[ -z "$health" ]]; then
      log_message "Listener health is offline; starting current app bundle."
      /bin/zsh "$START_LISTENER"
    fi
  fi
  sleep 2
done
