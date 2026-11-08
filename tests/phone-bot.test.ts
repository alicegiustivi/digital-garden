// The phone bot (phone-bot/Code.gs, issue #38) run against a pretend Telegram and a pretend Google Drive that is a real folder,
// so what it saves is read by the real Garden intake (src/server/inbox.ts): the two sides of the contract are tested together.
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-test-"));
const inbox = mkdtempSync(join(tmpdir(), "garden-inbox-"));
process.env.GARDEN_INBOX_DIR = inbox;
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const { localDay } = await import("../src/server/inbox.ts");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const OWNER = 111, STRANGER = 222, CODE = "ABCD-2345";
const source = readFileSync(join(import.meta.dirname, "../phone-bot/Code.gs"), "utf8");

type Call = { method: string; payload: any };
let calls: Call[], props: Map<string, string>, nextMsg: number, failNextFile: boolean, bigFile: boolean, bot: any;
let tick = 0, updateId = 0, clock = 0, telegram: any[], whileWaiting: (() => any[])[];

class Blob {
  constructor(public bytes: Buffer, public name = "", public mime = "") {}
  getBytes() { return [...this.bytes]; } getName() { return this.name; } setName(n: string) { this.name = n; return this; }
}
const iter = (items: any[]) => { let i = 0; return { hasNext: () => i < items.length, next: () => items[i++] }; };
const fileOf = (p: string) => ({ setContent: (c: string) => writeFileSync(p, c) });
function folderOf(path: string): any {
  return {
    getId: () => "id:" + path, getName: () => path.split("/").pop(),
    getFoldersByName: (n: string) => iter(existsSync(join(path, n)) && statSync(join(path, n)).isDirectory() ? [folderOf(join(path, n))] : []),
    getFilesByName: (n: string) => iter(existsSync(join(path, n)) && statSync(join(path, n)).isFile() ? [fileOf(join(path, n))] : []),
    createFolder: (n: string) => { mkdirSync(join(path, n)); return folderOf(join(path, n)); },
    createFile: (a: any, content?: string) => {
      if (failNextFile && typeof a !== "string") { failNextFile = false; throw new Error("Drive said no"); }
      if (typeof a === "string") { writeFileSync(join(path, a), content!); return fileOf(join(path, a)); }
      writeFileSync(join(path, a.getName()), a.bytes); return fileOf(join(path, a.getName()));
    },
    setTrashed: () => rmSync(path, { recursive: true, force: true }),
  };
}

function load() {
  const g: any = {
    // A clock the bot's waiting moves forward, so nothing really sleeps. Whatever is lined up in whileWaiting reaches Telegram meanwhile.
    Date: class extends Date { static now() { return clock; } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v),
      deleteProperty: (k: string) => props.delete(k), getProperties: () => Object.fromEntries(props),
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => "UTC" },
    Utilities: {
      sleep: (ms: number) => { clock += ms; const next = whileWaiting.shift(); if (next) telegram.push(...next()); },
      newBlob: (str: string, mime: string, name: string) => new Blob(Buffer.from(str), name, mime),
      formatDate: (d: Date, _tz: string, f: string) => { const iso = d.toISOString(); return f === "HH:mm" ? iso.slice(11, 16) : f === "yyyy-MM-dd" ? iso.slice(0, 10) : `${d.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]}`; },
    },
    DriveApp: { getFolderById: (id: string) => { if (id === "gone") throw new Error("no folder"); return folderOf(id === "inbox" ? inbox : id.replace(/^id:/, "")); } },
    UrlFetchApp: { fetch: (url: string, opts: any = {}) => {
      if (url.includes("/file/bot")) return { getResponseCode: () => 200, getBlob: () => new Blob(bigFile ? Buffer.alloc(21 * 1024 * 1024) : PNG) };
      const method = url.split("/").pop()!;
      const payload = opts.payload ? JSON.parse(opts.payload) : {};
      if (method === "getUpdates") {
        const result = telegram.filter((u) => u.update_id >= payload.offset).slice(0, payload.limit);
        return { getContentText: () => JSON.stringify({ ok: true, result }) };
      }
      calls.push({ method, payload });
      const result = method === "sendMessage" ? { ok: true, result: { message_id: nextMsg++ } } : method === "getFile" ? { ok: true, result: { file_path: "photos/x.jpg" } } : { ok: true, result: true };
      return { getContentText: () => JSON.stringify(result) };
    } },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }), everyDays: () => ({ atHour: () => ({ create() {} }) }) }) }) },
  };
  const mod: any = { exports: {} };
  new Function("module", ...Object.keys(g), source)(mod, ...Object.values(g));
  return mod.exports;
}

const now = () => Math.floor(Date.now() / 1000);
/** A message as Telegram would hand it to the bot (not yet delivered). */
function message(m: any, from = OWNER) {
  return { update_id: ++updateId, message: { message_id: ++tick + 1000, date: now(), from: { id: from }, chat: { id: from, type: "private" }, ...m } };
}
/** The owner sends one thing and the bot checks Telegram once. */
const send = (m: any, from = OWNER) => { telegram.push(message(m, from)); bot.poll(); };
const said = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text as string);
const folders = () => readdirSync(inbox).filter((f) => statSync(join(inbox, f)).isDirectory());
const capture = (name: string) => JSON.parse(readFileSync(join(inbox, name, "capture.json"), "utf8"));

let sqlite: ReturnType<typeof openDb>["sqlite"], app: ReturnType<typeof createApp>, read: string[];
const scan = async () => (await (await app.request("/api/inbox/scan", { method: "POST" })).json()) as any;
const today = () => localDay(new Date()); // the Mac's day, as the Garden files captures
const dayEntries = async () => ((await (await app.request(`/api/inbox/days/${today()}`)).json()) as any).entries as any[];
beforeEach(() => {
  for (const f of readdirSync(inbox)) rmSync(join(inbox, f), { recursive: true, force: true });
  calls = []; nextMsg = 5000; failNextFile = false; bigFile = false; tick = 0; telegram = []; whileWaiting = []; clock = Date.now();
  props = new Map([["BOT_TOKEN", "test-token"], ["INBOX_FOLDER_ID", "inbox"], ["SETUP_CODE", CODE], ["CHAT_ID", String(OWNER)]]);
  bot = load();
  sqlite = openDb(":memory:").sqlite; read = [];
  app = createApp(sqlite, { readLink: (_id, url) => read.push(url) });
});

describe("who the bot answers", () => {
  it("answers only the account that sends /start with the code, and forgets the code", () => {
    props.delete("CHAT_ID");
    send({ text: "/start WRONG" }, STRANGER);
    expect(props.has("CHAT_ID")).toBe(false);
    send({ text: "/start abcd2345" }, OWNER); // case and the dash don't matter
    expect(props.get("CHAT_ID")).toBe(String(OWNER));
    expect(props.has("SETUP_CODE")).toBe(false);
    calls = [];
    send({ text: "hello https://example.com/a" }, STRANGER);
    send({ text: "/start ABCD-2345" }, STRANGER);
    expect(calls).toEqual([]); // a stranger gets no answer at all
    expect(folders()).toEqual([]);
  });
  it("gives up on the code after five wrong tries", () => {
    props.delete("CHAT_ID");
    for (let i = 0; i < 5; i++) send({ text: "/start nope" }, STRANGER);
    expect(props.has("SETUP_CODE")).toBe(false);
    send({ text: "/start ABCD-2345" }, OWNER);
    expect(props.has("CHAT_ID")).toBe(false);
  });
});

describe("saving and handing over", () => {
  it("saves a link as a folder, replies Saved, and after the Garden takes it deletes the message and edits the receipt", async () => {
    send({ text: "worth reading #idea https://example.com/post." });
    expect(folders()).toEqual(["tg-1001"]);
    expect(capture("tg-1001")).toMatchObject({ messageId: "1001", links: ["https://example.com/post"], text: "worth reading #idea", files: [] });
    expect(said()[0]).toMatch(/^✓ Saved · link · \d\d:\d\d$/);

    bot.checkPickedUp(); // the Mac hasn't taken it: nothing happens
    expect(calls.some((c) => c.method === "deleteMessage")).toBe(false);

    expect((await scan()).taken).toBe(1); // the real Garden intake reads what the bot wrote
    expect(read).toEqual(["https://example.com/post"]);
    expect((await dayEntries())[0].comment).toBe("worth reading");
    expect(folders()).toEqual([]);

    calls = [];
    bot.checkPickedUp();
    expect(calls.filter((c) => c.method === "deleteMessage").map((c) => c.payload.message_id)).toEqual([1001]);
    expect(calls.find((c) => c.method === "editMessageText")!.payload).toMatchObject({ message_id: 5000, text: "✓ In your Garden" });
    calls = []; bot.checkPickedUp();
    expect(calls).toEqual([]); // done once
  });

  it("holds plain words a moment, then saves a Thought", async () => {
    send({ text: "just a thought #maybe" });
    expect(said()).toHaveLength(1);
    expect(said()[0]).toMatch(/^✓ Saved · note · /);
    await scan();
    expect((await dayEntries())[0].objects[0].type).toBe("thought");
  });

  it("saves a photo (the biggest size) and a #private mark makes the capture Private", async () => {
    send({ photo: [{ file_id: "s", file_size: 10 }, { file_id: "l", file_size: 90 }], caption: "my desk #PRIVATE" });
    expect(calls.find((c) => c.method === "getFile")!.payload.file_id).toBe("l");
    expect(said()[0]).toMatch(/· photo · \d\d:\d\d · Private$/);
    expect(readdirSync(join(inbox, folders()[0])).sort()).toEqual(["capture.json", "photo-1001.jpg"]);
    expect((await scan()).taken).toBe(1);
    expect((await dayEntries())[0].objects[0].private).toBe(true);
  });

  it("keeps a HEIC sent as a file", () => {
    send({ document: { file_id: "d", file_name: "IMG_1.HEIC", mime_type: "image/heic", file_size: 100 } });
    expect(capture("tg-1001").files).toEqual([{ name: "photo-1001.heic" }]);
  });

  it("joins a comment sent just before a forward, and keeps who it came from", async () => {
    whileWaiting.push(() => [message({ forward_origin: { type: "channel", chat: { title: "Daily Reads", username: "dailyreads" }, message_id: 77 }, text: "The forwarded words" })]); // arrives while the comment is held
    send({ text: "my take on this #private" });
    expect(folders()).toEqual(["tg-1002"]); // named after the forward's message
    expect(capture("tg-1002")).toMatchObject({ text: "my take on this #private", private: true, forward: { text: "The forwarded words", author: "Daily Reads", url: "https://t.me/dailyreads/77" } });
    expect(said()).toHaveLength(1);
    expect(said()[0]).toMatch(/forwarded post · \d\d:\d\d · Private$/);
    await scan();
    expect((await dayEntries())[0].comment).toBe("my take on this");
    calls = []; bot.checkPickedUp();
    expect(calls.filter((c) => c.method === "deleteMessage").map((c) => c.payload.message_id).sort()).toEqual([1001, 1002]); // both messages
  });

  it("makes one folder and one receipt for an album", async () => {
    const part = (extra = {}) => message({ photo: [{ file_id: "p", file_size: 50 }], media_group_id: "G9", ...extra });
    whileWaiting.push(() => [part()]); // the last photo reaches Telegram a moment after the first two
    telegram.push(part({ caption: "trip" }), part());
    bot.poll();
    expect(folders()).toEqual(["tg-gG9"]);
    expect(capture("tg-gG9").files).toHaveLength(3);
    expect(capture("tg-gG9").text).toBe("trip");
    expect(said()).toHaveLength(1);
    expect(said()[0]).toMatch(/· 3 photos · /);
    expect((await scan()).taken).toBe(1);
    expect((await dayEntries())[0].objects).toHaveLength(3);
  });

  it("doesn't read a message twice", () => {
    send({ text: "https://example.com/once" });
    bot.poll(); bot.poll();
    expect(said()).toHaveLength(1);
    expect(folders()).toHaveLength(1);
  });
});

describe("what the bot refuses and how it fails", () => {
  it.each([
    [{ voice: { file_id: "v" } }, "I can't keep voice notes yet, nothing was saved."],
    [{ document: { file_id: "d", file_name: "a.pdf", mime_type: "application/pdf", file_size: 5 } }, "I can't keep PDFs and other documents yet, nothing was saved."],
    [{ video: { file_id: "v" } }, "I can't keep videos yet, nothing was saved."],
    [{ photo: [{ file_id: "x", file_size: 25 * 1024 * 1024 }] }, "I can't keep files over 20 MB, nothing was saved."],
  ])("refuses %j", (msg, reply) => {
    send(msg);
    expect(said()).toEqual([reply]);
    expect(folders()).toEqual([]);
  });
  it("refuses a download that turns out over 20 MB", () => {
    bigFile = true;
    send({ photo: [{ file_id: "x", file_size: 100 }] });
    expect(said()).toEqual(["I can't keep files over 20 MB, nothing was saved."]);
    expect(folders()).toEqual([]);
  });
  it("says Not saved when Drive fails, leaves nothing half-written, and works when sent again", () => {
    failNextFile = true;
    send({ photo: [{ file_id: "x", file_size: 100 }] });
    expect(said()).toEqual(["✗ Not saved, please send it again"]);
    expect(folders()).toEqual([]);
    send({ photo: [{ file_id: "x", file_size: 100 }] });
    expect(folders()).toHaveLength(1);
  });
  it("never deletes anything when it can't check Drive, and says Not saved when the folder can't be opened", () => {
    send({ text: "https://example.com/pending" });
    calls = []; props.set("INBOX_FOLDER_ID", "gone");
    bot.checkPickedUp();
    expect(calls).toEqual([]);
    send({ text: "https://example.com/x" });
    expect(said()).toEqual(["✗ Not saved, please send it again"]);
  });
});

describe("commands and the heartbeat", () => {
  it("/waiting counts what is still in Drive; /help explains", () => {
    send({ text: "/waiting" });
    expect(said().pop()).toBe("Nothing is waiting. Everything you sent is in your Garden.");
    send({ text: "https://example.com/1" });
    send({ text: "https://example.com/2" });
    send({ text: "/waiting" });
    expect(said().pop()).toMatch(/^2 captures are waiting for your Mac, the oldest from today \d\d:\d\d$/);
    send({ text: "/help" });
    expect(said().pop()).toContain("#private");
  });
  it("sets up without a webhook and installs its three checks", () => {
    bot.connectBot();
    expect(calls.map((c) => c.method)).toContain("deleteWebhook");
    bot.installTriggers(); // runs without a hitch; the heartbeat is written
    expect(existsSync(join(inbox, "heartbeat.txt"))).toBe(true);
    bot.checkSetup();
  });
  it("writes the heartbeat file the Garden reads", async () => {
    bot.heartbeat();
    expect(existsSync(join(inbox, "heartbeat.txt"))).toBe(true);
    bot.heartbeat();
    const st = (await (await app.request("/api/inbox")).json()) as any;
    expect(st.lastSync).toBeTruthy();
    expect(st.warning).toBeNull();
  });
});

describe("the setup code on the Mac", () => {
  it("shows a one-time code, stable until renewed", async () => {
    const a = (await (await app.request("/api/inbox/setup")).json()) as any;
    expect(a.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await (await app.request("/api/inbox/setup")).json()) as any).toEqual(a);
    const b = (await (await app.request("/api/inbox/setup/new-code", { method: "POST" })).json()) as any;
    expect(b.code).not.toBe(a.code);
  });
});
