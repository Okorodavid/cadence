/**
 * Object storage. By default `public/media/**`, served by Next at `/media/**`.
 *
 * Set MEDIA_ROOT to a path outside `public/` (e.g. a mounted volume on a VPS)
 * for production: files created at runtime after `next build` are NOT picked up
 * by Next's static handler, so the `/media/[...path]` route streams them from
 * MEDIA_ROOT instead. Swap the functions at the bottom for S3/R2 if needed —
 * everything else in the app only ever sees a URL string.
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

export const MEDIA_ROOT = process.env.MEDIA_ROOT
  ? path.resolve(process.env.MEDIA_ROOT)
  : path.join(process.cwd(), "public", "media");
export const MEDIA_URL_PREFIX = "/media";

export function mediaPath(rel: string): string {
  return path.join(MEDIA_ROOT, rel.split("/").join(path.sep));
}

export function mediaUrl(rel: string): string {
  return `${MEDIA_URL_PREFIX}/${rel.split(path.sep).join("/")}`;
}

export async function ensureDirFor(rel: string): Promise<void> {
  await fs.mkdir(path.dirname(mediaPath(rel)), { recursive: true });
}

export async function ensureDir(rel: string): Promise<string> {
  const abs = mediaPath(rel);
  await fs.mkdir(abs, { recursive: true });
  return abs;
}

export async function saveBuffer(
  rel: string,
  data: Buffer | Uint8Array,
): Promise<string> {
  await ensureDirFor(rel);
  await fs.writeFile(mediaPath(rel), data);
  return mediaUrl(rel);
}

export function isLocalMediaUrl(url: string): boolean {
  return url.startsWith(MEDIA_URL_PREFIX + "/");
}

/** `/media/jobs/x/a.mp4` -> absolute disk path. */
export function localPathFromUrl(url: string): string {
  return mediaPath(url.slice(MEDIA_URL_PREFIX.length + 1));
}

/**
 * Give me a file on disk for this URL. Remote (Higgsfield) outputs expire, so
 * we mirror them into local storage the first time we touch them — that is
 * also what makes the export zip self-contained.
 */
export async function materialize(url: string, rel: string): Promise<string> {
  if (isLocalMediaUrl(url)) return localPathFromUrl(url);

  const abs = mediaPath(rel);
  try {
    await fs.access(abs);
    return abs; // already mirrored
  } catch {
    /* download below */
  }

  await ensureDirFor(rel);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(abs),
  );
  return abs;
}

/** Mirror a remote URL into storage and return the *local* URL. */
export async function mirror(url: string, rel: string): Promise<string> {
  if (isLocalMediaUrl(url)) return url;
  await materialize(url, rel);
  return mediaUrl(rel);
}

export async function exists(rel: string): Promise<boolean> {
  try {
    await fs.access(mediaPath(rel));
    return true;
  } catch {
    return false;
  }
}

/**
 * Windows holds handles open a moment after a reader finishes (the dev server
 * streaming an mp4, a just-exited ffmpeg), so a plain rm throws EBUSY. Retry,
 * and treat a stubborn file as non-fatal — the caller is clearing a cache.
 */
export async function removeDir(rel: string): Promise<void> {
  try {
    await fs.rm(mediaPath(rel), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250,
    });
  } catch (err) {
    console.warn(`[storage] could not fully remove ${rel}: ${(err as Error).message}`);
  }
}
