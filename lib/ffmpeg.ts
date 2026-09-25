/**
 * ffmpeg helpers. Everything spawns with an argv array (never a shell string)
 * so Windows paths with spaces — like this project's own folder — are safe.
 *
 * Where a filter needs a path (concat lists, subtitle files, fonts) we run
 * ffmpeg with `cwd` set to the working directory and pass a bare filename,
 * which sidesteps the `C:` drive-colon escaping trap in filtergraphs.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

export const VIDEO_W = 1080;
export const VIDEO_H = 1920;
export const FPS = 30;

export async function exec(
  bin: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) =>
      reject(new Error(`${bin} could not start: ${e.message}`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve(out || err);
      else reject(new Error(`${bin} exited ${code}\n${err.slice(-2500)}`));
    });
  });
}

export const ffmpeg = (args: string[], cwd?: string) =>
  exec(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], cwd);

export async function hasFfmpeg(): Promise<boolean> {
  try {
    await exec(FFMPEG, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

export async function probeDuration(file: string): Promise<number> {
  const out = await exec(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const n = Number.parseFloat(out.trim());
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/**
 * Still -> clip with a slow push-in (the Ken Burns fallback when we have an
 * image but no motion model output).
 */
export async function stillToClip(
  image: string,
  out: string,
  seconds: number,
  direction: "in" | "out" = "in",
): Promise<void> {
  const frames = Math.max(2, Math.round(seconds * FPS));
  // zoompan works on an upscaled source to avoid the jitter it is known for.
  const z =
    direction === "in"
      ? `min(1+0.0012*on,1.18)`
      : `max(1.18-0.0012*on,1)`;
  await ffmpeg([
    "-loop",
    "1",
    "-i",
    image,
    "-vf",
    [
      `scale=${VIDEO_W * 2}:${VIDEO_H * 2}:force_original_aspect_ratio=increase`,
      `crop=${VIDEO_W * 2}:${VIDEO_H * 2}`,
      `zoompan=z='${z}':d=${frames}:s=${VIDEO_W}x${VIDEO_H}:fps=${FPS}`,
      `setsar=1`,
    ].join(","),
    "-t",
    seconds.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-an",
    out,
  ]);
}

/**
 * Force any clip to exactly `seconds` at the house format: 1080x1920, 30fps,
 * no audio. Short clips hold their last frame; long clips get trimmed.
 * This is what makes concat + VO line up beat for beat.
 */
export async function normalizeClip(
  input: string,
  out: string,
  seconds: number,
): Promise<void> {
  // Clips are requested at <=5s to save credits. When a beat runs longer, slow
  // the footage to fill it (keeps motion) rather than freezing the last frame.
  // Cap the stretch so it never becomes obvious slow-motion; `tpad` clones the
  // final frame for anything left over.
  const src = await probeDuration(input);
  const stretch = src > 0.1 ? Math.min(seconds / src, 2.5) : 1;
  const filters = [
    `scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=increase`,
    `crop=${VIDEO_W}:${VIDEO_H}`,
    ...(stretch > 1.03 ? [`setpts=${stretch.toFixed(4)}*PTS`] : []),
    `fps=${FPS}`,
    `tpad=stop_mode=clone:stop_duration=30`,
    `setsar=1`,
  ];
  await ffmpeg([
    "-i",
    input,
    "-vf",
    filters.join(","),
    "-t",
    seconds.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-an",
    out,
  ]);
}

/** Concat pre-normalized clips (same codec/format) without re-encoding. */
export async function concatClips(
  dir: string,
  files: string[],
  out: string,
): Promise<void> {
  const listName = "concat.txt";
  const body = files.map((f) => `file '${path.basename(f)}'`).join("\n");
  await fs.writeFile(path.join(dir, listName), body + "\n", "utf8");
  await ffmpeg(
    ["-f", "concat", "-safe", "0", "-i", listName, "-c", "copy", out],
    dir,
  );
}

/** Concat narration wavs into one track. */
export async function concatAudio(
  dir: string,
  files: string[],
  out: string,
): Promise<void> {
  const listName = "concat-audio.txt";
  const body = files.map((f) => `file '${path.basename(f)}'`).join("\n");
  await fs.writeFile(path.join(dir, listName), body + "\n", "utf8");
  await ffmpeg(
    [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listName,
      "-ac",
      "2",
      "-ar",
      "48000",
      "-c:a",
      "pcm_s16le",
      out,
    ],
    dir,
  );
}

export async function silentWav(out: string, seconds: number): Promise<void> {
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=mono:sample_rate=48000",
    "-t",
    seconds.toFixed(3),
    "-c:a",
    "pcm_s16le",
    out,
  ]);
}

/** Mux video + narration (+ optional bed). Video length wins. */
export async function muxAudio(
  video: string,
  audio: string,
  out: string,
): Promise<void> {
  await ffmpeg([
    "-i",
    video,
    "-i",
    audio,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    out,
  ]);
}

/** Burn an .ass caption track. `dir` must contain both the ass and the font. */
export async function burnCaptions(
  dir: string,
  video: string,
  assFile: string,
  out: string,
): Promise<void> {
  await ffmpeg(
    [
      "-i",
      path.basename(video),
      "-vf",
      `subtitles=${path.basename(assFile)}:fontsdir=.`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      path.basename(out),
    ],
    dir,
  );
}

export async function grabFrame(
  video: string,
  out: string,
  atSeconds: number,
): Promise<void> {
  await ffmpeg([
    "-ss",
    atSeconds.toFixed(2),
    "-i",
    video,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    out,
  ]);
}

// ---------------------------------------------------------------------------
// Fonts — libass needs a real font file next to the .ass
// ---------------------------------------------------------------------------

const FONT_CANDIDATES = [
  "C:/Windows/Fonts/arialbd.ttf",
  "C:/Windows/Fonts/segoeuib.ttf",
  "C:/Windows/Fonts/impact.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
];

export const CAPTION_FONT_FILE = "caption.ttf";
/** Must match the family name inside the copied font for libass to bind it. */
export const CAPTION_FONT_NAME = "Arial";

/** Copy a bold system font into `dir` as caption.ttf. Returns false if none found. */
export async function provideCaptionFont(dir: string): Promise<boolean> {
  const target = path.join(dir, CAPTION_FONT_FILE);
  try {
    await fs.access(target);
    return true;
  } catch {
    /* copy below */
  }
  const envFont = process.env.CAPTION_FONT_PATH;
  const candidates = envFont ? [envFont, ...FONT_CANDIDATES] : FONT_CANDIDATES;
  for (const c of candidates) {
    try {
      await fs.copyFile(c, target);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Thumbnail scoring
// ---------------------------------------------------------------------------

/**
 * Mean luma standard deviation — a cheap stand-in for "how much contrast does
 * this frame have". Used to pick the strongest thumbnail out of candidates.
 */
export async function lumaStdDev(file: string): Promise<number> {
  try {
    const out = await exec(FFMPEG, [
      "-hide_banner",
      "-i",
      file,
      "-vf",
      "signalstats,metadata=print:key=lavfi.signalstats.YSTDDEV",
      "-f",
      "null",
      "-",
    ]);
    const values = [...out.matchAll(/YSTDDEV=([\d.]+)/g)].map((m) =>
      Number.parseFloat(m[1]),
    );
    if (!values.length) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  } catch {
    return 0;
  }
}

/** Pad (or trim) an audio file to exactly `seconds`, keeping A/V beats aligned. */
export async function fitAudio(
  input: string,
  out: string,
  seconds: number,
): Promise<void> {
  await ffmpeg([
    "-i",
    input,
    "-af",
    "apad",
    "-t",
    seconds.toFixed(3),
    "-ac",
    "1",
    "-ar",
    "48000",
    "-c:a",
    "pcm_s16le",
    out,
  ]);
}
