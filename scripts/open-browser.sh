#!/bin/bash
# Opens the Garden in the browser the owner chose. Used by the Garden.app launcher on every click.
#   open-browser.sh <url> <garden-folder>
# The choice is one word in <garden-folder>/browser.txt: arc, safari, chrome or default (set it with
# `npm run mac:browser -- arc`). With no file, nothing changes from before: a Chrome app window if Chrome
# is installed, otherwise the default browser. If the chosen browser is not installed, the default browser opens.
URL="$1"; HOME_DIR="${2:-$HOME/Garden}"
CHOICE="$({ tr -d '[:space:]' < "$HOME_DIR/browser.txt"; } 2>/dev/null | tr '[:upper:]' '[:lower:]')"
installed() { open -Ra "$1" >/dev/null 2>&1; }
case "$CHOICE" in
  arc)    APP="Arc" ;;
  safari) APP="Safari" ;;
  chrome) APP="Google Chrome" ;;
  default) open "$URL"; exit 0 ;;
  *)      APP="Google Chrome" ;;   # no choice made yet: the behaviour from before
esac
if ! installed "$APP"; then open "$URL"; exit 0; fi
if [ "$APP" = "Google Chrome" ]; then
  open -na "Google Chrome" --args --app="$URL"   # a window of its own, no tabs
else
  open -a "$APP" "$URL"                          # Arc and Safari have no such window from the command line
fi
