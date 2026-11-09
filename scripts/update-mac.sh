#!/bin/bash
# Updates the Garden to the newest tested version, only when you ask.
#   bash scripts/update-mac.sh --check    shows what an update would bring; changes nothing
#   bash scripts/update-mac.sh            backs up first, installs, checks it works, and switches back if it doesn't
# Recipe: docs/recipes.md. Your data in ~/Garden is never deleted; the only thing ever put back is the
# safety copy of the database this script makes just before it starts.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${GARDEN_LABEL:-com.digital-garden.server}"
PORT="${GARDEN_PORT:-4747}"
GARDEN="${GARDEN_DIR:-$HOME/Garden}"
cd "$REPO"

say() { printf '%s\n' "$*"; }
health() { for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/api/health" && return 0; sleep 0.5; done; return 1; }
count() { printf '%s' "$1" | sed -n 's/.*"objects":\([0-9]*\).*/\1/p'; }

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  say "Stopped: the code folder has changes of its own, so it is not safe to update. Nothing was changed."; exit 1
fi
OLD="$(git rev-parse HEAD)"
git fetch -q origin main || { say "Stopped: could not reach GitHub. Nothing was changed."; exit 1; }
NEW="$(git rev-parse origin/main)"
if [ "$OLD" = "$NEW" ] || git merge-base --is-ancestor "$NEW" "$OLD"; then say "Your Garden is already on the newest version."; exit 0; fi
say "An update is available. What it brings:"; git log --format='  - %s' "$OLD..$NEW"
[ "${1:-}" = "--check" ] && { say "Nothing was installed. Say \"update my Garden\" when you want it."; exit 0; }

BEFORE_JSON="$(health || true)"; BEFORE="$(count "$BEFORE_JSON")"
say; say "1/4 Backing up first…"
npm run -s backup -- now || { say "Stopped: the Backup did not work, so nothing was changed."; exit 1; }

say "2/4 Making a safety copy of the database on this Mac…"
STAMP="$(date +%Y-%m-%d-%H%M%S)"; SAFE="$GARDEN/before-update/garden-$STAMP.db"; mkdir -p "$GARDEN/before-update"
if [ -f "$GARDEN/garden.db" ]; then
  GARDEN_FROM="$GARDEN/garden.db" GARDEN_TO="$SAFE" node --input-type=module -e '
    import Database from "better-sqlite3";
    const db = new Database(process.env.GARDEN_FROM, { readonly: true });
    await db.backup(process.env.GARDEN_TO); db.close();' || { say "Stopped: could not make the safety copy. Nothing was changed."; exit 1; }
fi

install() { npm install --no-audit --no-fund && npm run -s mac:install; }
switch_back() {
  say; say "Something went wrong, so I am switching back to the previous version…"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  [ -f "$SAFE" ] && { cp "$SAFE" "$GARDEN/garden.db"; rm -f "$GARDEN/garden.db-wal" "$GARDEN/garden.db-shm"; }
  git reset -q --hard "$OLD" && install >/dev/null 2>&1
  AFTER_JSON="$(health || true)"
  if [ -n "$AFTER_JSON" ]; then say "Switched back. Your Garden is running the previous version again, with your data as it was before the update."; exit 1
  else say "I could not start the previous version either. Your data is safe: the Backup in Google Drive and the copy at $SAFE. Ask an agent to \"restore my Garden\"."; exit 2; fi
}

say "3/4 Installing the new version…"
git merge -q --ff-only "$NEW" || switch_back
install || switch_back
say "4/4 Checking it works…"
AFTER_JSON="$(health || true)"; AFTER="$(count "$AFTER_JSON")"
[ -n "$AFTER_JSON" ] || switch_back
if [ -n "$BEFORE" ] && [ "${AFTER:-0}" -lt "$BEFORE" ]; then say "The new version shows fewer Objects ($AFTER) than before ($BEFORE)."; switch_back; fi
say; say "Updated. The Garden is running the new version and shows ${AFTER:-?} Objects (before: ${BEFORE:-unknown})."
say "If anything looks wrong, say \"restore my Garden\". The safety copy is $SAFE."
