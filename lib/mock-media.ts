/**
 * MOCK=true media. Not stock footage and not stubs — ffmpeg actually renders
 * these, so the whole pipeline (concat, VO sync, caption burn, thumbnail,
 * export zip) runs for real on $0 and every artifact is a playable file.
 *
 * Flip MOCK=false and the same pipeline calls Higgsfield instead.
 */

import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import {
  CAPTION_FONT_FILE,
  FPS,
  VIDEO_H,
  VIDEO_W,
  ffmpeg,
  provideCaptionFont,
  stillToClip,
} from "./ffmpeg";
import { ensureDir, exists, mediaPath, mediaUrl } from "./storage";

const MOCK_DIR = "mock";

/** Stable palette per prompt so the same beat always looks the same. */
function palette(seed: string): { a: string; b: string; c: string } {
  const h = crypto.createHash("sha1").update(seed).digest();
  const hue = h[0] / 255;
  const pick = (offset: number, light: number) => {
    const t = (hue + offset) % 1;
    const r = Math.round(120 + 135 * Math.sin(2 * Math.PI * t) * light + 60);
    const g = Math.round(120 + 135 * Math.sin(2 * Math.PI * (t + 0.33)) * light + 40);
    const b = Math.round(120 + 135 * Math.sin(2 * Math.PI * (t + 0.66)) * light + 70);
    const cl = (n: number) => Math.max(12, Math.min(245, n)).toString(16).padStart(2, "0");
    return `0x${cl(r)}${cl(g)}${cl(b)}`;
  };
  return { a: pick(0, 0.9), b: pick(0.18, 0.55), c: pick(0.42, 0.75) };
}

function dims(aspectRatio: string): { w: number; h: number } {
  const [aw, ah] = aspectRatio.split(":").map(Number);
  if (!aw || !ah) return { w: VIDEO_W, h: VIDEO_H };
  if (aw >= ah) {
    const w = 1920;
    return { w, h: Math.round((w * ah) / aw / 2) * 2 };
  }
  const h = 1920;
  return { w: Math.round((h * aw) / ah / 2) * 2, h };
}

/**
 * A few words off the prompt, so mock frames are still readable as beats.
 * Prompts are built as "<content>. <style lock>", and the look book prepends
 * an appearance lock — so drop the locks and keep the last real sentence.
 */
function label(prompt: string): string {
  const withoutLocks = prompt
    .replace(/stylized 3D cinematic animation.*$/i, "")
    .replace(/vertical smartphone photo.*$/i, "")
    .replace(/clean editorial b-roll still.*$/i, "");

  const sentences = withoutLocks
    .split(/\.\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chosen = sentences[sentences.length - 1] ?? prompt;
  const words = chosen.split(/,/)[0].trim().split(/\s+/).slice(0, 6);

  // Wrap at three words. Clips get a 1.18x push-in, which magnifies anything
  // baked into the still — a single long line would be cropped at both edges.
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += 3) {
    lines.push(words.slice(i, i + 3).join(" "));
  }
  return lines.join("\n").toUpperCase();
}

export async function mockImage(params: {
  prompt: string;
  aspectRatio?: string;
  index?: number;
}): Promise<string> {
  const { prompt, aspectRatio = "9:16", index = 0 } = params;
  const key = crypto
    .createHash("sha1")
    .update(`img|${prompt}|${aspectRatio}|${index}`)
    .digest("hex")
    .slice(0, 16);
  const rel = `${MOCK_DIR}/${key}.jpg`;
  if (await exists(rel)) return mediaUrl(rel);

  const dir = await ensureDir(MOCK_DIR);
  const { w, h } = dims(aspectRatio);
  const p = palette(prompt + index);
  const hasFont = await provideCaptionFont(dir);

  const textFile = `${key}.txt`;
  await fs.writeFile(path.join(dir, textFile), label(prompt) || "SCENE", "utf8");

  const filters = [
    `gradients=s=${w}x${h}:c0=${p.a}:c1=${p.b}:c2=${p.c}:nb_colors=3:x0=0:y0=0:x1=${w}:y1=${h}`,
    `format=yuv420p`,
  ];

  const vf = [
    `noise=alls=8:allf=t+u`,
    `vignette=PI/5`,
    ...(hasFont
      ? [
          `drawtext=textfile=${textFile}:fontfile=${CAPTION_FONT_FILE}:fontsize=${Math.round(w / 34)}:fontcolor=white@0.88:box=1:boxcolor=black@0.3:boxborderw=20:x=(w-text_w)/2:y=(h-text_h)/2+h*0.18:line_spacing=10`,
        ]
      : []),
  ].join(",");

  await ffmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      filters.join(","),
      "-frames:v",
      "1",
      "-vf",
      vf,
      "-q:v",
      "3",
      `${key}.jpg`,
    ],
    dir,
  );

  await fs.rm(path.join(dir, textFile), { force: true });
  return mediaUrl(rel);
}

export async function mockVideo(params: {
  prompt: string;
  seconds: number;
  aspectRatio?: string;
  fromImageUrl?: string;
}): Promise<string> {
  const { prompt, seconds, aspectRatio = "9:16", fromImageUrl } = params;
  const key = crypto
    .createHash("sha1")
    .update(`vid|${prompt}|${seconds}|${aspectRatio}|${fromImageUrl ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  const rel = `${MOCK_DIR}/${key}.mp4`;
  if (await exists(rel)) return mediaUrl(rel);

  const dir = await ensureDir(MOCK_DIR);
  const out = path.join(dir, `${key}.mp4`);

  if (fromImageUrl) {
    // Image-to-video stand-in: real camera move over the real still.
    const src = fromImageUrl.startsWith("/media/")
      ? mediaPath(fromImageUrl.slice("/media/".length))
      : await downloadTemp(fromImageUrl, dir, key);
    await stillToClip(src, out, seconds, "in");
    return mediaUrl(rel);
  }

  const { w, h } = dims(aspectRatio);
  const p = palette(prompt);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `gradients=s=${w}x${h}:c0=${p.a}:c1=${p.b}:c2=${p.c}:nb_colors=3:speed=0.02:d=${Math.ceil(
      seconds,
    )}:r=${FPS}`,
    "-t",
    seconds.toFixed(3),
    "-vf",
    "vignette=PI/5,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-an",
    out,
  ]);
  return mediaUrl(rel);
}

async function downloadTemp(
  url: string,
  dir: string,
  key: string,
): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mock: cannot fetch ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const file = path.join(dir, `${key}-src.jpg`);
  await fs.writeFile(file, buf);
  return file;
}
