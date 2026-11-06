// Shrinking photos with the Mac's own tool (sips). It reads iPhone HEIC too, and nothing leaves the Mac.
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { imagesDir } from "./paths.ts";

const run = promisify(execFile);
export class UnreadableImage extends Error {}

const sips = (...args: string[]) => run("/usr/bin/sips", args, { timeout: 60_000 });

/** Writes <id>.jpg (about 2048 px) and <id>.thumb.jpg (about 400 px). The original is never kept. */
export async function shrinkImage(id: string, name: string, bytes: Buffer) {
  const work = await mkdtemp(join(tmpdir(), "garden-img-"));
  try {
    const ext = (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "img").toLowerCase();
    const src = join(work, `original.${ext}`);
    await writeFile(src, bytes);
    await mkdir(imagesDir(), { recursive: true });
    const file = join(imagesDir(), `${id}.jpg`);
    const thumb = join(imagesDir(), `${id}.thumb.jpg`);
    try {
      await sips("-s", "format", "jpeg", "-s", "formatOptions", "80", "-Z", "2048", src, "--out", file);
      await sips("-s", "format", "jpeg", "-s", "formatOptions", "70", "-Z", "400", file, "--out", thumb);
    } catch {
      await rm(file, { force: true }); await rm(thumb, { force: true });
      throw new UnreadableImage(`“${name}” could not be read as a picture`);
    }
    const info = await sips("-g", "pixelWidth", "-g", "pixelHeight", file);
    const num = (k: string) => Number(info.stdout.match(new RegExp(`${k}: (\\d+)`))?.[1]) || null;
    return { width: num("pixelWidth"), height: num("pixelHeight"), bytes: (await stat(file)).size };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export const readImage = (id: string, thumb: boolean) => readFile(join(imagesDir(), `${id}${thumb ? ".thumb" : ""}.jpg`));
