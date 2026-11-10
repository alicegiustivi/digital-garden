# Digital Garden

Your personal Garden. It runs only on your Mac, nobody else can reach it, and everything it keeps lives in the `Garden` folder in your home folder (`~/Garden`), never in this code folder.

## Set it up (once)

In Terminal, inside this folder:

```bash
npm install
```

```bash
npm run mac:install
```

This builds the screen, starts the Garden, makes it start by itself every time you log in, and puts an app called **Garden** in your `Applications` folder (inside your home folder). Drag it to your Dock. Clicking it opens the Garden in its own window.

If you move this folder, run `npm run mac:install` again from the new place.

## Start, stop

- **Start:** click the Garden icon in the Dock. (It also starts on its own when you log in.)
- **Stop for good (and stop starting at login):**

```bash
npm run mac:uninstall
```

  Your data is not touched. Run `npm run mac:install` to turn it back on.
- **Stop for now:** the Garden restarts itself if it is stopped. To really stop it, use the command above.

## Where your data is

`~/Garden` holds `garden.db` (everything you keep) and an `images` folder. The log of what the server is doing is `~/Garden/server.log`.

## Reset (start again with an empty Garden)

This **deletes everything you have saved**. The safe way is to set it aside rather than delete it:

```bash
npm run mac:uninstall
```

```bash
mv ~/Garden ~/Garden-old
```

```bash
npm run mac:install
```

A fresh empty Garden is created. If you change your mind, uninstall again and move `~/Garden-old` back to `~/Garden`.

## Install, update, restore: ask an agent

Open this folder with an agent and say **"install my Garden"**, **"update my Garden"**, **"restore my Garden"** or **"bring back 'X' from Monday's backup"**. It follows the written recipes in `docs/recipes.md`, backing up first and switching back if an update fails. Nothing updates unless you ask.

## Phone capture

Send links, photos and thoughts from your phone through a private Telegram bot. The one-time setup checklist is in `docs/phone-bot-setup.md`; the bot's code is `phone-bot/Code.gs`.

## Privacy

The Garden only answers requests from your own Mac (address `127.0.0.1`). Other devices on your network cannot open it, so there is no login.

## For developers

```bash
npm test          # database rules (every piece needs an Origin), search, server
npm run typecheck
```

Set `GARDEN_DIR` and `GARDEN_PORT` to run a throwaway copy somewhere else.
