# Recipes for agents

Say one of these to an agent in this code folder and it follows the matching recipe, step by step, telling you what it is doing in plain words:

- **"Install my Garden"** (a new or wiped Mac)
- **"Update my Garden"**
- **"Restore my Garden"** (dead Mac, new Mac, big mistake)
- **"Bring back 'X' from Monday's backup"** (one Object)

**Rules for every recipe**
- The Garden's data is `~/Garden`. **Never delete or overwrite it**; move it aside instead.
- **Never type, paste, print or save the backup password, the Telegram bot key or any other secret.** The password lives in the Mac's Keychain; when a step needs it, the owner types it into the Terminal (hidden) or into a macOS prompt.
- Use plain words. Tell the owner what is about to happen and why. Stop and ask when something is not as the recipe says.
- An Export is not a Backup. Restoring always uses a Backup.
- Nothing is installed or updated unless the owner asked in this conversation. The Garden never updates itself.
- To rehearse a recipe without touching the real Garden, set `GARDEN_DIR`, `GARDEN_PORT`, `GARDEN_LABEL`, `GARDEN_APP` and `GARDEN_BACKUP_DIR` to throwaway values (a spare folder, a port other than 4747, a made-up label such as `com.digital-garden.rehearsal`). The scripts honour all of them.

---

## 1. First install ("install my Garden")

For a Mac that does not have the Garden yet. About 10 minutes plus the phone setup.

1. **Check the basics.** `node --version` should print 20 or newer (if it is missing, ask the owner to install Node from nodejs.org; that is the only thing to install by hand) and `git --version` should work.
2. **Get the code**, into a folder the owner will keep (for example `~/Desktop/projects/digital-garden`):
   ```bash
   git clone https://github.com/alicegiustivi/digital-garden.git
   cd digital-garden && npm install
   ```
3. **Is there already a Garden?** If `~/Garden` exists, stop and ask: this may be a restore (recipe 3) rather than a first install. Never install over it.
4. **Install and start:** `npm run mac:install`. It builds the screen, starts the Garden, makes it start at every login, and puts **Garden** in `~/Applications`. Tell the owner to drag it to the Dock.
5. **Check it:** `curl -s http://127.0.0.1:4747/api/health` answers `{"ok":true,…}`. Open the Garden and capture one thought with ⌘N so the owner sees it work.
6. **Save to Garden bookmark (browser).** In the Garden: More ▸ **Bookmark**. The page has a button called **Save to Garden**; the owner drags it onto the browser's bookmarks bar (Chrome: ⌘⇧B shows the bar; Safari: View ▸ Show Favorites Bar). Test it: open any web page, click the bookmark. The Capture window opens in the Garden with that page's link filled in. The bookmark only opens the Garden on this Mac; if the Garden is not running it simply doesn't open.
7. **Backups.** Follow `docs/backup.md` ▸ *Set up (once)*: a Drive folder, `npm run backup:password` (owner types it; **write it down**), pick the folder in More ▸ Backup, **Back up now**, then `npm run backup -- test-restore`.
8. **Phone capture.** Follow the checklist `docs/phone-bot-setup.md` with the owner, one step at a time. It is optional and can be done another day. The owner does the Telegram and Google clicks; never ask for the bot key.
9. **Tell the owner what now exists** and where: the Garden app in the Dock, `~/Garden` for the data, the Backup folder in Drive, and the four phrases at the top of this page.

**If it fails:** `~/Garden/server.log` shows what the Garden says. `npm run mac:uninstall` stops it (data untouched); fix; run `npm run mac:install` again. If `launchctl bootstrap` reports an I/O error, `launchctl bootout gui/$(id -u)/com.digital-garden.server` and run `npm run mac:install` once more.

---

## 2. Update ("update my Garden")

Runs only when the owner asks. The Garden keeps running a fixed, tested version until then.

1. **See what is new, installing nothing:** `bash scripts/update-mac.sh --check`. Read the list to the owner in plain words and ask whether to go ahead. If it says "already on the newest version", stop.
2. **Make sure a Backup works.** `npm run backup -- status` should show a recent Backup. If no Backup folder is set, stop and set it up first (`docs/backup.md`); an update without a Backup is not allowed.
3. **Update:** `bash scripts/update-mac.sh` (also `npm run mac:update`). It does, in order:
   1. a **Backup to Google Drive now** (stops if it fails; nothing changed);
   2. a **safety copy of the database** on the Mac, in `~/Garden/before-update/`;
   3. fetches and installs the new version, rebuilds and restarts the Garden;
   4. checks the Garden answers and shows no fewer Objects than before.
4. **If any step fails it switches back by itself:** puts the safety copy of the database back, returns the code to the previous version, restarts, and says so. Exit code 1 = switched back; 2 = it could not even start the old version (then tell the owner their data is safe in the Drive Backup and offer recipe 3).
5. **Afterwards**, open the Garden with the owner and look at a few Objects. Tell them what changed.

The script refuses to run if the code folder has uncommitted changes of its own, and it never changes anything in `~/Garden` except putting the safety copy back after a failure.

---

## 3. Restore the whole Garden ("restore my Garden")

For a dead Mac, a new Mac, or a big mistake. The old Garden is moved aside, never overwritten.

1. **Install the code, but not a new Garden yet:** steps 1–2 of recipe 1 (`git clone`, `npm install`). Do **not** run `mac:install` yet. If the Garden is running (`launchctl list | grep digital-garden`), stop it: `launchctl bootout gui/$(id -u)/com.digital-garden.server`.
2. **Google Drive.** The owner opens the Google Drive app and signs in (a new Mac needs this first). Wait until the Backup folder shows in Finder under *Google Drive ▸ My Drive*. Find it: it contains `garden-backup.json`.
3. **Pick the day.** `GARDEN_BACKUP_DIR="<that folder>" npm run backup -- list` shows the days (the last 4 weeks, newest first). Ask the owner which; the newest is the default.
4. **Move the old Garden aside**, if there is one: `mv ~/Garden ~/Garden-before-restore-$(date +%Y-%m-%d)`. Tell the owner it is kept and that they can delete it themselves later.
5. **Restore:** `GARDEN_BACKUP_DIR="<folder>" npm run backup -- restore <day|latest> ~/Garden`. On a new Mac the Keychain has no password, so it asks; the owner types it hidden (never into chat). It prints the database check (`ok`) and the number of Objects and images; read these to the owner. If it reports missing images, say so plainly: Drive may still be downloading.
6. **Remember the password on this Mac:** `npm run backup:password` (owner types it twice). Skip if the Keychain already had it.
7. **Start the Garden:** `npm run mac:install`, then check `curl -s http://127.0.0.1:4747/api/health` shows the expected Object count. Drag **Garden** to the Dock again.
8. **Reconnect what lives outside the database.** The Backup holds the Garden's Objects and images, not its settings:
   - More ▸ Backup: choose the Backup folder again, then **Back up now**.
   - Daily Inbox: **Choose the folder** for the phone capture folder (see `docs/phone-bot-setup.md` ▸ step 1). The Telegram bot and its Apps Script live in the owner's Google account and keep working; if the bot needs to be made again, follow that checklist.
   - Redo the **Save to Garden** bookmark (recipe 1, step 6) if the browser is new.
9. Tell the owner what was restored (day, Objects, images) and that anything made after that day is not in it.

---

## 4. Bring back one thing ("bring back 'X' from Monday's backup")

For one Object that was deleted for good or changed by mistake. (If it was only deleted in the last 30 days, it is in the **Bin**: More ▸ Bin ▸ Restore, no Backup needed. Tell the owner first.)

1. **Find the day.** `npm run backup -- list`. "Monday" means the most recent Monday in that list; confirm the date with the owner.
2. **Look first, change nothing:** `npm run backup -- bring-back <day> "<words of the title>" --look`.
   - If it says several match, it lists them with their ids. Read the list to the owner and ask which; run again with that id in place of the words.
   - If it says the Object is already in the Garden, nothing is overwritten. To get the *old* version back, the owner can rename or delete the current one first, and then you run this again.
3. **Bring it back:** the same command without `--look`. The owner types the backup password hidden if the Keychain does not have it. It opens that Backup in a spare folder (deleted again at the end) and copies **only that Object** into the live Garden: its fields, text, Tags, AI notes and picture, each keeping its Origin exactly as it was.
4. **It is marked as restored.** The Object gets the Tag `restored-<day>` (an owner Tag; the owner can remove it with one click). Connections come back only to Objects that are in the Garden now; the command says how many it left out.
5. Open the Garden, search for the Object together with the owner, and confirm it looks right.

---

## Record of trying each recipe for real

Each recipe was run once on this Mac against a throwaway Garden (its own folder, port 4801, its own launchd label; the owner's real Garden untouched) and the results noted here.

| Recipe | Tried | Result |
|---|---|---|
| 1. First install | 2026-11-09, `mac:install` on a fresh clone, throwaway Garden | The Garden started, answered `/api/health`, captured a thought. Launchd start worked first time. |
| 2. Update | 2026-11-09, throwaway remote | **Good update:** backed up, safety copy, installed, "Updated, 1 Object (before: 1)". **Broken build and a version that crashes at start:** both switched back to the previous version automatically, with the data intact and the Garden answering. `--check` changed nothing. |
| 3. Restore | 2026-11-09, throwaway Garden | Old Garden moved aside, restored from the newest Backup (database check ok, 2 Objects), started, answered. Settings outside the database (Backup folder, phone folder) had to be chosen again, as step 8 says. |
| 4. Bring back one thing | 2026-11-09, throwaway Garden | An Object deleted for good was brought back from that day's Backup, tagged `restored-2026-11-09`, Origins intact; running it again refused ("already in the Garden"). |

Still to do with the owner watching on their real Mac: the owner's own first run of recipe 2 happens when this build ships (the update is exactly what installs it).
