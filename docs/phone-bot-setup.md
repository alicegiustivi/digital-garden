# Phone bot setup checklist

Do this once (and again if you ever lose the bot). It takes about 15 minutes. The Telegram and Google steps are yours to click; an agent can walk you through them one at a time. **Never paste the bot key into chat, into the Garden or into any file in this repo.** It only ever goes into the Apps Script's settings.

What you end up with: you message a private Telegram bot from your phone; a Google Apps Script (yours, free) checks Telegram once a minute and saves each message as a folder in a Google Drive folder; Drive syncs it to your Mac; the Garden takes it and the bot then deletes your message and says "✓ In your Garden". The bot code is `phone-bot/Code.gs`.

There is no web app and no webhook: Telegram's calls to an Apps Script web app get stuck (Google answers with a redirect, which Telegram treats as a failure and backs off), so the script asks Telegram instead. The price is that answers can take up to about a minute.

## Before you start
- [ ] The Garden is running on your Mac and Google Drive for desktop is signed in.
- [ ] Open the Garden → **Daily Inbox** → **Set up the phone bot**: it shows a **one-time code**. Keep that page open.

## 1. The Drive folder
- [ ] In Google Drive (drive.google.com) make a folder, e.g. **Captured**.
- [ ] Copy its **id**: open the folder; the address ends `…/folders/<this part>`.
- [ ] On the Mac, find the same folder in Finder (under *Google Drive → My Drive*). Right-click it → **Available offline** (so the Mac always has the files, not just links).
- [ ] In the Garden's Daily Inbox, **Choose the folder** and paste its Mac path (e.g. `~/Library/CloudStorage/GoogleDrive-…/My Drive/Captured`).

## 2. A new bot in Telegram
- [ ] In Telegram, message **@BotFather** → `/newbot` → choose a name and a username ending in `bot`. Always make a *new* bot; never reuse an old one.
- [ ] Keep the **key** BotFather gives you (a long line with a colon). Don't share it. If it leaks, `/revoke` it in BotFather.

## 3. The Apps Script
- [ ] Go to script.google.com → **New project**. Name it *Garden bot*.
- [ ] Replace everything in `Code.gs` with the contents of `phone-bot/Code.gs` from this repo. Save.
- [ ] **Project Settings** (gear) → **Script Properties** → add three:
  - `BOT_TOKEN` = the key from BotFather
  - `INBOX_FOLDER_ID` = the folder id from step 1
  - `SETUP_CODE` = the one-time code from the Garden
- [ ] You do **not** deploy anything as a web app.

## 4. Switch it on and check
- [ ] In the editor pick the function **installTriggers** → **Run**. Google asks you to authorise: *Advanced → Go to Garden bot (unsafe)* is the normal screen for your own script ("This app isn't verified"). Allow Drive and external requests. (It checks Telegram every minute, checks what the Mac has taken every 10 minutes, and refreshes `heartbeat.txt` daily.)
- [ ] Pick **connectBot** → **Run**. The log should say *Ready*.
- [ ] In Telegram open your new bot and send `/start <the one-time code>` (e.g. `/start ABCD-2345`). Within a minute it answers *Connected*. From now on it answers only your account.
- [ ] Run **checkSetup**. Every line should start with ✓ (the last check of Telegram should be seconds ago).

## 5. Test from your phone
- [ ] Send a link → *✓ Saved · link · 14:02* (within about a minute). The Garden shows it in the Daily Inbox; within ~10 minutes the bot deletes your message and the receipt says *✓ In your Garden*. To see that at once, run **checkPickedUp** in the editor.
- [ ] Send a photo, a thought with `#private`, and a forward from a channel (with a short comment just before it).
- [ ] Send a voice note → *I can't keep voice notes yet, nothing was saved.*
- [ ] `/waiting` and `/help` answer.

## If something is wrong
- Run **checkSetup**: it names the missing piece without showing any secret.
- *Last check of Telegram* is old or missing: run **installTriggers** again and wait a minute. In *Executions* there should be a `poll` row every minute.
- A webhook is still set: run **connectBot**.
- To see what the bot did, open *Executions* and click a `poll` row: it logs *Handling update…* (the kind of message, never its text) and any error.
- The Garden says the Drive folder hasn't synced in a day: Google Drive isn't running on the Mac, or the daily trigger stopped (run **installTriggers** again).
- To pair a different account: delete the `CHAT_ID` property, add a new `SETUP_CODE` (the Garden's **Make a new code**), send `/start <code>`.
- Updating the bot: paste the new `Code.gs` and save. Nothing to deploy.

## Limits worth knowing
- The bot checks Telegram about once a minute, so replies take up to a minute or so (a plain thought a few seconds more: it is held briefly in case a forward follows it). Google allows a free account 90 minutes of trigger time a day; this uses about 25.
- Telegram lets a bot delete your message only within 48 hours; a capture the Mac takes later stays in the chat (the receipt still changes).
- Voice notes, PDFs and other documents, videos and files over 20 MB are refused and stay in the chat.
- The Garden retries a capture by itself while Drive is still finishing downloading it.
