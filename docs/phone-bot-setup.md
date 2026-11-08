# Phone bot setup checklist

Do this once (and again if you ever lose the bot). It takes about 20 minutes. The Telegram and Google steps are yours to click; an agent can walk you through them one at a time. **Never paste the bot key into chat, into the Garden or into any file in this repo.** It only ever goes into the Apps Script's settings.

What you end up with: you message a private Telegram bot from your phone; a Google Apps Script (yours, free) saves each message as a folder in a Google Drive folder; Drive syncs it to your Mac; the Garden takes it and the bot then deletes your message and says "✓ In your Garden". The bot code is `phone-bot/Code.gs`.

## Before you start
- [ ] The Garden is running on your Mac and Google Drive for desktop is signed in.
- [ ] Open the Garden → **Daily Inbox**. Open **Set up the phone bot**: it shows a **one-time code** and a **web-address secret**. Keep that page open.

## 1. The Drive folder
- [ ] In Google Drive (drive.google.com) make a folder, e.g. **Garden inbox**.
- [ ] Copy its **id**: open the folder; the address ends `…/folders/<this part>`.
- [ ] On the Mac, find the same folder in Finder (under *Google Drive → My Drive*). Right-click it → **Available offline** (so the Mac always has the files, not just links).
- [ ] In the Garden's Daily Inbox, **Choose the folder** and paste its Mac path (e.g. `~/Library/CloudStorage/GoogleDrive-…/My Drive/Garden inbox`).

## 2. A new bot in Telegram
- [ ] In Telegram, message **@BotFather** → `/newbot` → choose a name and a username ending in `bot`. Always make a *new* bot; never reuse an old one.
- [ ] Keep the **key** BotFather gives you (a long line with a colon). Don't share it. If it leaks, `/revoke` it in BotFather.

## 3. The Apps Script
- [ ] Go to script.google.com → **New project**. Name it *Garden bot*.
- [ ] Replace everything in `Code.gs` with the contents of `phone-bot/Code.gs` from this repo. Save.
- [ ] **Project Settings** (gear) → **Script Properties** → add four:
  - `BOT_TOKEN` = the key from BotFather
  - `INBOX_FOLDER_ID` = the folder id from step 1
  - `WEBHOOK_SECRET` = the web-address secret from the Garden
  - `SETUP_CODE` = the one-time code from the Garden
- [ ] **Deploy → New deployment → Web app**. *Execute as:* **Me**. *Who has access:* **Anyone** (Telegram has to reach it; the secret in the address and the one-account rule keep everyone else out). Click **Deploy**.
- [ ] Google asks you to authorise: *Advanced → Go to Garden bot (unsafe)* is the normal screen for your own script ("This app isn't verified"). Allow Drive and external requests.

## 4. Connect and check
- [ ] In the editor pick the function **installTriggers** → **Run** (every 10 minutes the bot checks what the Mac has taken; every day it refreshes `heartbeat.txt`).
- [ ] Pick **connectBot** → **Run**. The log should say *Connected*.
- [ ] Pick **checkSetup** → **Run**. Every line should start with ✓, except "Not paired yet".
- [ ] In Telegram open your new bot and send `/start <the one-time code>` (e.g. `/start ABCD-2345`). It answers *Connected*. From now on it answers only your account. Run **checkSetup** again: *Paired with your account*.

## 5. Test from your phone
- [ ] Send a link → *✓ Saved · link · 14:02*. Within a minute or so the Garden shows it in the Daily Inbox; within ~10 minutes the bot deletes your message and the receipt says *✓ In your Garden*.
- [ ] Send a photo, a thought with `#private`, and a forward from a channel.
- [ ] Send a voice note → *I can't keep voice notes yet, nothing was saved.*
- [ ] `/waiting` and `/help` answer.
- [ ] Turn the Mac's Wi-Fi off, send a link, run `/waiting` → it counts it; reconnect and it clears.

## If something is wrong
- Run **checkSetup** in the editor: it names the missing piece without showing any secret.
- No answer at all: **connectBot** again after any new deployment (a *New version* of the same deployment keeps the address; a brand-new deployment gives a new one).
- The Garden says the Drive folder hasn't synced in a day: Google Drive isn't running on the Mac, or the bot's daily trigger stopped (run **installTriggers** again).
- To pair a different account: delete the `CHAT_ID` property, add a new `SETUP_CODE` (the Garden's **Make a new code**), send `/start <code>`.
- Updating the bot: paste the new `Code.gs`, then **Deploy → Manage deployments → Edit → New version**.

## Limits worth knowing
- Telegram lets a bot delete your message only within 48 hours; a capture the Mac takes later stays in the chat (the receipt still changes).
- Voice notes, PDFs and other documents, videos and files over 20 MB are refused and stay in the chat.
- Text you send alone is held about 5 seconds in case a forward follows it, so "Saved" for a plain thought takes a few seconds.
