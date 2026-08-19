#!/usr/bin/env bash
# The POSIX counterpart to unity-attend.ps1: keep a host-bound application usable while an
# unattended session works, for a bounded time, then exit.
#
#   attend.sh <seconds> [application-name]
#
# Wire it up with:
#   "attendCommand": "bash .dogwatch/adapters/attend.sh {{seconds}}"
#
# The adapter contract dogwatch relies on, whatever the language:
#   - it takes the number of seconds to spend and returns within roughly that time;
#   - it prints one line per thing it did, and the last line is what lands in supervisor-log.md;
#   - it exits 0 when it did its job and non-zero when it could not, so playbook rule 3 can tell
#     "nudged the environment" from "the environment is not there";
#   - it is idempotent and safe to run at any moment, including mid-session. It must never touch
#     project files, kill the agent, or restart anything the session is holding.

set -uo pipefail

SECONDS_TO_ATTEND="${1:-90}"
APP="${2:-Unity}"
INTERVAL=2

case "$SECONDS_TO_ATTEND" in
  ''|*[!0-9]*) echo "usage: attend.sh <seconds> [application-name]" >&2; exit 2 ;;
esac

focus_macos() {
  osascript -e "tell application \"$APP\" to activate" >/dev/null 2>&1
}

# Requires Accessibility permission for whatever runs this script (System Settings > Privacy &
# Security > Accessibility). Without it the call fails quietly and only the focus keeping works,
# which is why its failure is not treated as fatal.
dismiss_macos() {
  osascript >/dev/null 2>&1 <<OSA
    tell application "System Events"
      tell process "$APP"
        if exists (button "Don't Save" of window 1) then
          click button "Don't Save" of window 1
          return "clicked"
        end if
      end tell
    end tell
OSA
}

focus_linux() {
  if command -v wmctrl >/dev/null 2>&1; then
    wmctrl -a "$APP" >/dev/null 2>&1
  elif command -v xdotool >/dev/null 2>&1; then
    xdotool search --name "$APP" windowactivate >/dev/null 2>&1
  else
    return 2
  fi
}

case "$(uname -s)" in
  Darwin)
    if ! pgrep -x "$APP" >/dev/null 2>&1 && ! pgrep -f "$APP" >/dev/null 2>&1; then
      echo "NO_APP: $APP is not running"
      exit 1
    fi
    focus=focus_macos
    dismiss=dismiss_macos
    ;;
  Linux)
    if ! pgrep -f "$APP" >/dev/null 2>&1; then
      echo "NO_APP: $APP is not running"
      exit 1
    fi
    if ! focus_linux; then
      echo "NO_TOOL: install wmctrl or xdotool, or point attendCommand at your own script"
      exit 1
    fi
    focus=focus_linux
    dismiss=:
    ;;
  *)
    echo "UNSUPPORTED: $(uname -s); on Windows use unity-attend.ps1"
    exit 1
    ;;
esac

deadline=$(( $(date +%s) + SECONDS_TO_ATTEND ))
clicks=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ "$dismiss" != ":" ] && [ "$($dismiss)" = "clicked" ]; then
    clicks=$((clicks + 1))
    echo "dismissed a modal in $APP at $(date +%H:%M:%S)"
  fi
  "$focus"
  sleep "$INTERVAL"
done

echo "done, attended $APP for ${SECONDS_TO_ATTEND}s, modals dismissed=$clicks"
