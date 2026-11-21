#!/bin/zsh
# Summarizes ~/Library/Logs/PR FX Key Journal.tsv: how many shortcut presses
# actually ran, failed, expired, or were handed to Premiere and why.
#
#   ./tools/key-report.sh            # whole journal
#   ./tools/key-report.sh 2026-10-29 # only lines whose timestamp starts with this
set -euo pipefail

journal="$HOME/Library/Logs/PR FX Key Journal.tsv"
prefix="${1:-}"
if [[ ! -f "$journal" ]]; then
  echo "No journal yet at: $journal"
  echo "It is written by listener builds with the event tap; press a few shortcuts first."
  exit 0
fi

/usr/bin/awk -F'\t' -v prefix="$prefix" '
NR == 1 { next }
prefix != "" && index($1, prefix) != 1 { next }
{
  event = $2; seq = $3; key = $4; command = $5; detail = $6
  if (event == "passed") {
    passed++
    reason = detail
    if (reason ~ /^Text input/) reason = "typing in a text field (correct)"
    else if (reason ~ /^Last click was outside/) reason = "last click outside Timeline"
    else if (reason ~ /^No click recorded/) reason = "no click recorded yet"
    else if (reason ~ /^Timeline panel could not/) reason = "Timeline not found"
    reasons[reason]++
    per[command, "passed"]++; names[command] = 1
    next
  }
  if (seq == "") next
  if (event == "fired") { fired++; per[command, "fired"]++; names[command] = 1; firedSeq[seq] = command }
  else if (event == "ok") { ok++; per[command, "ok"]++; names[command] = 1; resolved[seq] = 1 }
  else if (event == "failed") { failed++; per[command, "failed"]++; names[command] = 1; resolved[seq] = 1
    if (detail != "") { lastFail[command] = detail } }
  else if (event == "expired") { expired++; per[command, "expired"]++; names[command] = 1; resolved[seq] = 1 }
}
END {
  pressed = fired + passed
  printf "Shortcut presses seen:   %d\n", pressed
  printf "  fired (PR FX took it): %d\n", fired
  printf "    succeeded:           %d\n", ok
  printf "    failed in Premiere:  %d\n", failed
  printf "    expired in queue:    %d\n", expired
  unresolved = 0
  for (s in firedSeq) if (!(s in resolved)) unresolved++
  printf "    no result yet:       %d\n", unresolved
  printf "  passed to Premiere:    %d\n", passed
  for (r in reasons) printf "    %-34s %d\n", r ":", reasons[r]
  if (pressed > 0) {
    printf "\nPresses that ran successfully: %.0f%%\n", 100 * ok / pressed
  }
  if (fired > 0) {
    printf "Fired presses that succeeded: %.0f%%\n", 100 * ok / fired
  }
  printf "\n%-48s %6s %6s %6s %6s %6s\n", "Command", "fired", "ok", "failed", "expird", "passed"
  for (c in names) {
    printf "%-48s %6d %6d %6d %6d %6d\n", substr(c, 1, 48), per[c, "fired"], per[c, "ok"], per[c, "failed"], per[c, "expired"], per[c, "passed"]
  }
  hasFail = 0
  for (c in lastFail) { if (!hasFail) { print "\nLast failure message per command:"; hasFail = 1 } printf "  %s: %s\n", c, substr(lastFail[c], 1, 160) }
}' "$journal"
