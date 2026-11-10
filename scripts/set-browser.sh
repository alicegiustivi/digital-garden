#!/bin/bash
# Chooses the browser the Garden icon in the Dock opens: arc, safari, chrome, or default (your Mac's own default).
#   bash scripts/set-browser.sh arc        (also: npm run mac:browser -- arc)
#   bash scripts/set-browser.sh            shows the current choice
# Takes effect on the next click of the Dock icon; no reinstall needed. Only writes one word to ~/Garden/browser.txt.
set -euo pipefail
GARDEN="${GARDEN_DIR:-$HOME/Garden}"
FILE="$GARDEN/browser.txt"
if [ $# -eq 0 ]; then
  if [ -f "$FILE" ]; then echo "The Garden opens in: $(tr -d '[:space:]' < "$FILE")"; else echo "No choice made: a Chrome window if Chrome is installed, otherwise your default browser."; fi
  exit 0
fi
CHOICE="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
case "$CHOICE" in
  arc) APP="Arc" ;; safari) APP="Safari" ;; chrome) APP="Google Chrome" ;;
  default) mkdir -p "$GARDEN"; echo default > "$FILE"; echo "The Garden will open in your Mac's default browser."; exit 0 ;;
  *) echo "Choose one of: arc, safari, chrome, default."; exit 1 ;;
esac
if ! open -Ra "$APP" >/dev/null 2>&1; then echo "$APP is not installed on this Mac, so nothing was changed."; exit 1; fi
mkdir -p "$GARDEN"; echo "$CHOICE" > "$FILE"
echo "The Garden will open in $APP the next time you click it in the Dock."
