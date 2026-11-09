# Backups and restoring the Garden

A **Backup** (not an Export) is a daily copy of the Garden, scrambled (AES-256-GCM) on this Mac with a password only you know, and saved into a folder that the Google Drive app syncs. The Garden never holds a Google login or token. The last 4 weeks are kept; each image is copied once.

## Set up (once)
- [ ] In Finder, under *Google Drive → My Drive*, make a folder, e.g. **Garden backups**. Right-click ▸ **Available offline** is not needed; Drive uploads what the Garden writes.
- [ ] In a Terminal, in the Garden's code folder, run `npm run backup:password`. macOS asks you to type the password (hidden, twice). It goes into your Keychain. **Write it down somewhere safe too**: without it no Backup can be opened.
- [ ] In the Garden: More ▸ Backup ▸ paste the folder's path ▸ **Use this folder** ▸ **Back up now**.
- [ ] Prove it works: `npm run backup -- test-restore` restores the newest Backup into a spare folder, checks the database and images, then deletes the spare copy.

## Every day
The Garden makes a Backup after 03:00 (or as soon as the Mac is awake after that). More ▸ Backup shows "Backed up today 03:12". If none has worked for two days, **This week** shows "Backup hasn't run since Tuesday" with **Try again**. There are no system notifications.

## Restoring (recipe for the agent: "restore my Garden"; the full recipes are in `recipes.md`)
1. Install the Garden on the Mac (`git clone`, `npm install`, `npm run mac:install`), then stop it: `launchctl bootout gui/$(id -u)/com.digital-garden.server`.
2. Owner signs in to the Google Drive app. Find the Backup folder (look for `garden-backup.json`).
3. Owner chooses the day: `GARDEN_BACKUP_DIR=<folder> npm run backup -- list` (newest by default).
4. If `~/Garden` exists, **move it aside** (e.g. `mv ~/Garden ~/Garden-before-restore-<date>`); never overwrite it.
5. `GARDEN_BACKUP_DIR=<folder> npm run backup -- restore <day|latest> ~/Garden`. If the Keychain has no password (a new Mac), it asks; the owner types it hidden. Run `npm run backup:password` afterwards so the new Mac remembers it.
6. Start the Garden (`npm run mac:install`), set More ▸ Backup to the folder, and reconnect the phone capture folder under Daily Inbox.

**One thing from an old Backup** ("bring back 'X' from Monday"): `npm run backup -- bring-back <day> "<title>" [--look]` opens that day in a spare folder and copies just that Object back, tagged `restored-<day>`, Origins intact. See `recipes.md` recipe 4.
