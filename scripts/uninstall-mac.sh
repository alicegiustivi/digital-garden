#!/bin/bash
# Stops the Garden, removes start-at-login and the Dock app. Your data in ~/Garden is NOT touched.
LABEL="${GARDEN_LABEL:-com.digital-garden.server}"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "${GARDEN_APP:-$HOME/Applications/Garden.app}"
echo "Garden stopped and removed from login. Your data in ~/Garden is untouched."
