#!/bin/bash
# Sets up the Garden on this Mac:
#   1. builds the screen,
#   2. makes "Garden.app" in ~/Applications (drag it to the Dock),
#   3. starts the Garden now and every time you log in.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
LABEL="com.digital-garden.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP="$HOME/Applications/Garden.app"
PORT="${GARDEN_PORT:-4747}"

cd "$REPO"
[ -d node_modules ] || npm install
npm run build

mkdir -p "$HOME/Garden" "$HOME/Library/LaunchAgents" "$HOME/Applications"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string><string>$REPO/node_modules/.bin/tsx</string><string>$REPO/src/server/main.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key><dict><key>GARDEN_PORT</key><string>$PORT</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Garden/server.log</string>
  <key>StandardErrorPath</key><string>$HOME/Garden/server.log</string>
</dict></plist>
PLISTEOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# The Dock app: a small launcher that makes sure the Garden is running, then opens a window.
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cat > "$APP/Contents/Info.plist" <<INFOEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Garden</string>
  <key>CFBundleDisplayName</key><string>Garden</string>
  <key>CFBundleIdentifier</key><string>com.digital-garden.launcher</string>
  <key>CFBundleExecutable</key><string>Garden</string>
  <key>CFBundleIconFile</key><string>Garden</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict></plist>
INFOEOF
cat > "$APP/Contents/MacOS/Garden" <<LAUNCHEOF
#!/bin/bash
URL="http://127.0.0.1:$PORT"
launchctl kickstart "gui/\$(id -u)/$LABEL" 2>/dev/null || true
for i in \$(seq 1 40); do curl -s -o /dev/null "\$URL/api/health" && break; sleep 0.25; done
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="\$URL"
else
  open "\$URL"
fi
LAUNCHEOF
chmod +x "$APP/Contents/MacOS/Garden"
[ -f "$REPO/mac/Garden.icns" ] && cp "$REPO/mac/Garden.icns" "$APP/Contents/Resources/Garden.icns"
touch "$APP"

echo
echo "Done. The Garden is running at http://127.0.0.1:$PORT and will start at every login."
echo "Open $APP and drag it to your Dock."
