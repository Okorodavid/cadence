/**
 * The renderer. Same path for all three modes — only the prompts and the
 * caption style differ.
 *
 *   narration -> measure -> stills (Soul) -> motion (Seedance) ->
 *   normalize to the measured beat length -> concat -> mux -> burn -> package
 *
 * Voice is generated first on purpose: the measured wav length is what every
 * clip gets trimmed to, so picture and audio stay locked beat for beat without
 * forced alignment.
 *
 * Every step is idempotent — a scene that already has a clipUrl is skipped, so
 * "regenerate scene 4" only costs scene 4.
 */

import path from "node:path";
import fs from "node:fs/promises";
import type { CalendarJob, Scene } from "@prisma/client";

import { db, readList } from "@/lib/db";
import {
  burnCaptions,
  concatAudio,
  concatClips,
  fitAudio,
  grabFrame,
  lumaStdDev,
  normalizeClip,
  probeDuration,
  provideCaptionFont,
  stillToClip,
} from "@/lib/ffmpeg";
import {
  generateSoulImage,
  isMock,
  seedanceImageToVideo,
  seedanceRefToVideo,
  type AspectRatio,
  type VideoDuration,
} from "@/lib/higgsfield";
import { buildAss, buildCues, buildSrt, type CaptionStyle } from "@/lib/captions";
import { hfConcurrency, mapPool } from "@/lib/pool";
import { lockPrompt } from "@/lib/prompts";
import { speak, voiceSignature, type VoiceSpec } from "@/lib/tts";
import { ensureDir, materialize, mediaPath, mediaUrl, saveBuffer } from "@/lib/storage";

export type RenderOptions = {
  /** Look book URLs — the face lock for ugc_ad. */
  characterRefs?: string[];
  captionStyle?: CaptionStyle;
  aspectRatio?: AspectRatio;
  onLog?: (message: string) => Promise<void> | void;
  /** Re-render these scene orders even if they already have media. */
  regenerate?: number[];
  /** Narrator voice (from the character). Defaults to the provider voice. */
  voice?: VoiceSpec | null;
};

export type RenderResult = {
  videoUrl: string;
  srtUrl: string;
  thumbnailUrl: string;
  voiceUrl: string;
  durationSeconds: number;
};

export async function renderJob(
  job: CalendarJob,
  scenes: Scene[],
  opts: RenderOptions = {},
): Promise<RenderResult> {
  const log = async (m: string) => {
    console.log(`[render ${job.id}] ${m}`);
    await opts.onLog?.(m);
  };

  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  if (!ordered.length) throw new Error("Job has no scenes to render");

  const captionStyle: CaptionStyle =
    opts.captionStyle ?? (job.mode === "faceless_yt" ? "lower-third" : "center-punch");
  const aspect = opts.aspectRatio ?? "9:16";
  const regen = new Set(opts.regenerate ?? []);

  const jobRel = `jobs/${job.id}`;
  const workRel = `${jobRel}/work`;
  const jobDir = await ensureDir(jobRel);
  const workDir = await ensureDir(workRel);

  // 1 ── narration ---------------------------------------------------------
  const voiceSig = voiceSignature(opts.voice);
  await log(`voicing ${ordered.length} beats`);
  const timings: { scene: Scene; audio: string; seconds: number }[] = [];
  for (const scene of ordered) {
    // Voice signature in the filename: change the voice and the next render
    // re-voices instead of reusing narration spoken in the old voice.
    const rel = `${workRel}/vo-${pad(scene.order)}-${voiceSig}.wav`;
    const stale = regen.has(scene.order);
    const existing = !stale && scene.audioUrl ? mediaPath(rel) : null;
    let seconds: number;
    let absPath: string;

    if (existing && (await fileExists(existing))) {
      absPath = existing;
      seconds = await probeDuration(existing);
    } else {
      const spoken = await speak({
        text: scene.narration,
        rel,
        voice: opts.voice,
      });
      absPath = spoken.absPath;
      seconds = spoken.seconds;
      await db.scene.update({
        where: { id: scene.id },
        data: { audioUrl: spoken.url },
      });
    }

    // Picture and audio for a beat must be the *same* length. Pad the picture
    // without padding the audio and every later beat's voice slides over the
    // previous beat's shot — a full second of drift by the end of a short.
    const beat = Math.max(1.2, seconds);
    let audioPath = absPath;
    if (beat > seconds + 0.02) {
      audioPath = path.join(workDir, `vo-${pad(scene.order)}-fit.wav`);
      await fitAudio(absPath, audioPath, beat);
    }
    timings.push({ scene, audio: audioPath, seconds: beat });
    if (Math.abs(beat - scene.seconds) > 0.05) {
      await db.scene.update({ where: { id: scene.id }, data: { seconds: beat } });
    }
  }

  const total = timings.reduce((a, t) => a + t.seconds, 0);
  await log(`narration total ${total.toFixed(1)}s`);

  // 2 ── stills + motion (the Higgsfield calls) ----------------------------
  const concurrency = hfConcurrency();
  await log(`generating visuals via Higgsfield${isMock() ? " (MOCK)" : ""}, concurrency ${concurrency}`);

  await mapPool(timings, concurrency, async ({ scene, seconds }) => {
    const stale = regen.has(scene.order);
    try {
      await db.scene.update({
        where: { id: scene.id },
        data: { status: "imaging", error: null },
      });

      // -- still
      let imageUrl = stale ? null : await usable(scene.imageUrl);
      if (!imageUrl) {
        const prompt = lockPrompt(scene.visualPrompt, job.mode);
        const [url] = await generateSoulImage({
          prompt,
          custom_reference_id: null,
          aspect_ratio: aspect,
          num_images: 1,
        });
        imageUrl = await mirrorInto(url, `${jobRel}/still-${pad(scene.order)}.jpg`);
        await db.scene.update({
          where: { id: scene.id },
          data: { imageUrl, status: "animating" },
        });
      } else {
        await db.scene.update({ where: { id: scene.id }, data: { status: "animating" } });
      }

      // -- motion
      let clipUrl = stale ? null : await usable(scene.clipUrl);
      if (!clipUrl) {
        const motionPrompt = `${scene.visualPrompt}. Camera: ${scene.camera}. Continuous motion throughout, no cuts.`;
        const duration = requestDuration(seconds);
        const refs = opts.characterRefs ?? [];

        const remote =
          job.mode === "ugc_ad" && refs.length
            ? await seedanceRefToVideo({
                prompt: `${motionPrompt} Same person as the reference images, product clearly visible, no extra faces.`,
                // Identity refs first, this beat's own still last. Every one of
                // them has to be a URL the model can fetch, so local look book
                // files get pushed to Higgsfield storage first.
                image_urls: await Promise.all(
                  [...refs.slice(0, 3), imageUrl]
                    .filter(Boolean)
                    .map((u) => publicFacingUrl(u as string)),
                ),
                duration,
                aspect_ratio: aspect,
              })
            : await seedanceImageToVideo({
                prompt: motionPrompt,
                image_url: await publicFacingUrl(imageUrl),
                duration,
                aspect_ratio: aspect,
              });

        clipUrl = await mirrorInto(remote, `${jobRel}/clip-${pad(scene.order)}.mp4`);
        await db.scene.update({ where: { id: scene.id }, data: { clipUrl } });
      }

      await db.scene.update({ where: { id: scene.id }, data: { status: "done" } });
    } catch (err) {
      const message = (err as Error).message;
      await log(`scene ${scene.order} failed: ${message}`);
      await db.scene.update({
        where: { id: scene.id },
        data: { status: "failed", error: message.slice(0, 500) },
      });
      // A dead beat must not kill the short — the still (or a colour card)
      // carries it with a camera move so the cut still plays.
      const fresh = await db.scene.findUnique({ where: { id: scene.id } });
      if (!fresh?.imageUrl) throw err;
    }
  });

  // 3 ── normalize every beat to its measured length -----------------------
  await log("conforming beats");
  const normalized: string[] = [];
  for (const { scene, seconds } of timings) {
    const fresh = await db.scene.findUnique({ where: { id: scene.id } });
    const clip = await usable(fresh?.clipUrl ?? null);
    const still = await usable(fresh?.imageUrl ?? null);
    const out = path.join(workDir, `beat-${pad(scene.order)}.mp4`);

    if (clip) {
      const src = await materialize(clip, `${jobRel}/clip-${pad(scene.order)}.mp4`);
      await normalizeClip(src, out, seconds);
    } else if (still) {
      const src = await materialize(still, `${jobRel}/still-${pad(scene.order)}.jpg`);
      await stillToClip(src, out, seconds, scene.order % 2 === 0 ? "in" : "out");
    } else {
      throw new Error(`Scene ${scene.order} produced no usable media`);
    }
    normalized.push(out);
  }

  // 4 ── assemble ----------------------------------------------------------
  await log("stitching");
  const silent = path.join(workDir, "silent.mp4");
  await concatClips(workDir, normalized, silent);

  const voice = path.join(workDir, "voice.wav");
  await concatAudio(
    workDir,
    timings.map((t) => t.audio),
    voice,
  );

  const withAudio = path.join(workDir, "with-audio.mp4");
  await concatAudioSafe(silent, voice, withAudio);

  // 5 ── captions ----------------------------------------------------------
  let cursor = 0;
  const cues = buildCues(
    timings.map(({ scene, seconds }) => {
      const start = cursor;
      cursor += seconds;
      return { start, end: cursor, narration: scene.narration };
    }),
    captionStyle === "center-punch" ? 4 : 7,
  );

  const srt = buildSrt(cues);
  const srtUrl = await saveBuffer(`${jobRel}/captions.srt`, Buffer.from(srt, "utf8"));

  const finalAbs = path.join(jobDir, "final.mp4");
  const hasFont = await provideCaptionFont(workDir);
  if (hasFont && cues.length) {
    await fs.writeFile(
      path.join(workDir, "captions.ass"),
      buildAss(cues, captionStyle),
      "utf8",
    );
    await burnCaptions(workDir, withAudio, "captions.ass", path.join(workDir, "burned.mp4"));
    await fs.copyFile(path.join(workDir, "burned.mp4"), finalAbs);
  } else {
    await log("no system font found — shipping without burned captions (srt still exported)");
    await fs.copyFile(withAudio, finalAbs);
  }

  // 6 ── thumbnail: 3 candidates, keep the highest-contrast one ------------
  // Pulled from the pre-caption cut — a thumbnail with burned-in subtitle
  // fragments across the middle of it is unusable.
  const duration = await probeDuration(finalAbs);
  const marks = [duration * 0.06, duration * 0.42, duration * 0.78];
  const candidates: { file: string; score: number }[] = [];
  for (const [i, at] of marks.entries()) {
    const file = path.join(workDir, `thumb-${i}.jpg`);
    try {
      await grabFrame(withAudio, file, at);
      candidates.push({ file, score: await lumaStdDev(file) });
    } catch {
      /* skip an unreadable timestamp */
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const thumbAbs = path.join(jobDir, "thumbnail.jpg");
  if (candidates.length) {
    await fs.copyFile(candidates[0].file, thumbAbs);
  } else {
    await grabFrame(withAudio, thumbAbs, 0.1);
  }

  await log(`done — ${duration.toFixed(1)}s`);

  return {
    videoUrl: mediaUrl(`${jobRel}/final.mp4`),
    srtUrl,
    thumbnailUrl: mediaUrl(`${jobRel}/thumbnail.jpg`),
    voiceUrl: mediaUrl(`${workRel}/voice.wav`),
    durationSeconds: duration,
  };
}

// ---------------------------------------------------------------------------

/**
 * Seedance/Kling take enum durations (3/5/10). We cap the request at 5s: a 10s
 * clip is roughly double the credits, and beats over ~5s are conformed to
 * length by `normalizeClip` (slight slow-down to fill, then a held frame for
 * any remainder) — so paying for 10s only to trim it back is wasted spend.
 */
function requestDuration(seconds: number): VideoDuration {
  return seconds <= 3.2 ? 3 : 5;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

async function fileExists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * A row can outlive its file, or outlive a *good* file — a cleared cache, a
 * killed render that left a truncated mp4 with no moov atom, an interrupted
 * download. Cached media is only reused if it is on disk and actually opens;
 * anything else is regenerated rather than blowing up at the conform step.
 */
async function usable(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (!url.startsWith("/media/")) return url; // remote, assume live

  const abs = mediaPath(url.slice("/media/".length));
  if (!(await fileExists(abs))) return null;

  try {
    const { size } = await fs.stat(abs);
    if (size < 1024) return null; // empty or stub

    // Videos are the expensive ones to regenerate and the easy ones to
    // truncate, so pay for a probe before trusting them.
    if (abs.endsWith(".mp4")) {
      const seconds = await probeDuration(abs);
      if (!(seconds > 0.05)) return null;
    }
  } catch {
    return null; // unreadable / unprobeable
  }

  return url;
}

/** Pull a Higgsfield output into local storage (their URLs expire). */
async function mirrorInto(url: string, rel: string): Promise<string> {
  if (url.startsWith("/media/")) return url;
  await materialize(url, rel);
  return mediaUrl(rel);
}

/**
 * Image-to-video needs a URL the model can fetch. Local-only files get pushed
 * to Higgsfield storage first; in MOCK the local path is fine.
 *
 * Cached because the look book references are the same handful of files on
 * every beat of every UGC job — uploading them once per scene would be pure
 * waste.
 */
const uploadCache = new Map<string, Promise<string>>();

async function publicFacingUrl(url: string): Promise<string> {
  if (!url.startsWith("/media/")) return url;
  if (isMock()) return url;

  const cached = uploadCache.get(url);
  if (cached) return cached;

  const pending = (async () => {
    const { uploadFile } = await import("@/lib/higgsfield");
    const abs = mediaPath(url.slice("/media/".length));
    const buf = await fs.readFile(abs);
    return uploadFile(buf, url.endsWith(".png") ? "image/png" : "image/jpeg");
  })();

  uploadCache.set(url, pending);
  pending.catch(() => uploadCache.delete(url)); // don't cache a failure
  return pending;
}

/** Mux, but tolerate a silent/zero-length voice track. */
async function concatAudioSafe(
  video: string,
  audio: string,
  out: string,
): Promise<void> {
  const { muxAudio } = await import("@/lib/ffmpeg");
  try {
    await muxAudio(video, audio, out);
  } catch {
    await fs.copyFile(video, out);
  }
}

export { readList };
