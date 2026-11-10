import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The Dock icon opens the browser the owner chose (issue #106). A stand-in `open` records what it was asked to do.
let dir: string, garden: string, log: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "browser-"));
  garden = join(dir, "Garden"); log = join(dir, "open.log");
  writeFileSync(join(dir, "open"), `#!/bin/bash
if [ "$1" = "-Ra" ]; then case " $FAKE_MISSING " in *" $2 "*) exit 1;; esac; exit 0; fi
echo "$@" >> "${log}"
`);
  chmodSync(join(dir, "open"), 0o755);
  return () => rmSync(dir, { recursive: true, force: true });
});
const env = (extra: Record<string, string> = {}) => ({ ...process.env, PATH: `${dir}:${process.env.PATH}`, GARDEN_DIR: garden, FAKE_MISSING: "", ...extra });
const launch = (choice: string | null, extra: Record<string, string> = {}) => {
  execFileSync("bash", ["scripts/open-browser.sh", "http://127.0.0.1:4747", garden], { env: env(extra) });
  return existsSync(log) ? readFileSync(log, "utf8").trim() : "";
};
const choose = (c: string) => { execFileSync("mkdir", ["-p", garden]); writeFileSync(join(garden, "browser.txt"), c + "\n"); };

describe("which browser the Garden icon opens", () => {
  it("changes nothing for someone who chose nothing: a Chrome app window", () => {
    expect(launch(null)).toBe('-na Google Chrome --args --app=http://127.0.0.1:4747');
  });
  it("opens Arc when Arc was chosen", () => { choose("arc"); expect(launch("arc")).toBe("-a Arc http://127.0.0.1:4747"); });
  it("opens Safari when Safari was chosen", () => { choose("Safari"); expect(launch("safari")).toBe("-a Safari http://127.0.0.1:4747"); });
  it("opens the Mac's default browser when asked", () => { choose("default"); expect(launch("default")).toBe("http://127.0.0.1:4747"); });
  it("falls back to the default browser when the chosen one is not installed", () => {
    choose("arc"); expect(launch("arc", { FAKE_MISSING: "Arc" })).toBe("http://127.0.0.1:4747");
  });
  it("falls back to the default browser when Chrome is missing and nothing was chosen", () => {
    expect(launch(null, { FAKE_MISSING: "Google Chrome" })).toBe("http://127.0.0.1:4747");
  });
});

describe("choosing the browser", () => {
  const set = (arg: string, extra: Record<string, string> = {}) => spawnSync("bash", ["scripts/set-browser.sh", arg], { env: env(extra), encoding: "utf8" });
  it("remembers the choice in one small file", () => {
    const r = set("Arc"); expect(r.status).toBe(0);
    expect(readFileSync(join(garden, "browser.txt"), "utf8").trim()).toBe("arc");
  });
  it("refuses a browser it does not know, or one that is not installed, and changes nothing", () => {
    expect(set("netscape").status).toBe(1);
    expect(set("arc", { FAKE_MISSING: "Arc" }).status).toBe(1);
    expect(existsSync(join(garden, "browser.txt"))).toBe(false);
  });
  it("says what the choice is", () => {
    set("safari");
    expect(spawnSync("bash", ["scripts/set-browser.sh"], { env: env(), encoding: "utf8" }).stdout).toContain("safari");
  });
});
