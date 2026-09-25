/**
 * Job dispatcher. A job walks: idea -> scripted -> rendering -> review -> ready.
 * Anything that throws lands it in `failed` with the error kept on the row.
 */

import { db, readJson, readList, writeList } from "@/lib/db";
import { checkTopic, type BrandContext } from "@/lib/prompts";
import { assertWithinBudget, recordSpend } from "@/lib/spend";
import { faceRefs } from "./character";
import { writeFacelessScript, beatsToScript } from "./faceless";
import { renderJob } from "./render";
import { UgcInputSchema, writeUgcScript } from "./ugc";
import { writeZachScript } from "./zach";
import type { Mode, ScriptResult } from "./types";

export async function log(
  jobId: string,
  message: string,
  level: "info" | "warn" | "error" = "info",
): Promise<void> {
  await db.jobLog.create({ data: { jobId, message: message.slice(0, 1000), level } });
}

async function brandFor(workspaceId: string): Promise<BrandContext> {
  const kit = await db.brandKit.findFirst({ where: { workspaceId } });
  if (!kit) return {};
  return {
    niche: kit.niche,
    audience: kit.audience,
    tone: kit.tone,
    hookStyle: kit.hookStyle,
    cta: kit.cta,
    bannedPhrases: readList(kit.bannedPhrases),
  };
}

// ---------------------------------------------------------------------------
// Stage 1 — write
// ---------------------------------------------------------------------------

export async function scriptJob(jobId: string): Promise<void> {
  const job = await db.calendarJob.findUniqueOrThrow({ where: { id: jobId } });
  const brand = await brandFor(job.workspaceId);
  const mode = job.mode as Mode;

  const guard = checkTopic(job.topic || job.title);
  if (!guard.ok) throw new Error(guard.reason);

  let script: ScriptResult;
  let source: "llm" | "fallback";
  let captionVariants: string[] = [];

  if (mode === "zach_short") {
    const r = await writeZachScript({ topic: job.topic, brand });
    script = r.script;
    source = r.source;
  } else if (mode === "faceless_yt") {
    const inputs = readJson<{ length?: "short" | "long" }>(job.inputs, {});
    const r = await writeFacelessScript({
      topic: job.topic,
      title: job.title || undefined,
      brand,
      length: inputs.length ?? "short",
    });
    script = r.script;
    source = r.source;
  } else {
    const character = job.characterId
      ? await db.character.findUnique({ where: { id: job.characterId } })
      : null;
    const r = await writeUgcScript({
      input: UgcInputSchema.parse(readJson(job.inputs, {})),
      brand,
      characterName: character?.name ?? "the creator",
    });
    script = r.script;
    source = r.source;
    captionVariants = r.captionVariants;
  }

  await log(jobId, `script written by ${source === "llm" ? "Claude" : "template fallback"} — ${script.beats.length} beats`);

  await db.$transaction([
    db.scene.deleteMany({ where: { jobId } }),
    ...script.beats.map((beat, i) =>
      db.scene.create({
        data: {
          jobId,
          order: i + 1,
          seconds: beat.seconds,
          narration: beat.narration,
          visualPrompt: beat.visualPrompt,
          camera: beat.camera,
          onScreenText: beat.onScreenText ?? "",
        },
      }),
    ),
    db.calendarJob.update({
      where: { id: jobId },
      data: {
        status: "scripted",
        title: script.title,
        hook: script.hook,
        script: beatsToScript(script.beats),
        caption: script.caption,
        description: script.description,
        tags: writeList(script.tags),
        inputs: JSON.stringify({
          ...readJson<Record<string, unknown>>(job.inputs, {}),
          ...(captionVariants.length ? { captionVariants } : {}),
        }),
        error: null,
      },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Stage 2 — render
// ---------------------------------------------------------------------------

export async function renderJobById(
  jobId: string,
  opts: { regenerate?: number[] } = {},
): Promise<void> {
  const job = await db.calendarJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { scenes: true, character: true },
  });
  if (!job.scenes.length) throw new Error("Nothing to render — script the job first");

  // Seatbelt: refuse to start if this render would blow the weekly cap.
  // No-op in MOCK or when uncapped. Throwing here lands the job in `failed`
  // (runJob's catch) with the cap message, before any Higgsfield call.
  const estimate = await assertWithinBudget(job.workspaceId, job.scenes);

  await db.calendarJob.update({
    where: { id: jobId },
    data: { status: "rendering", error: null },
  });

  const refs = job.character ? faceRefs(job.character) : [];

  // The character narrates every video. Only UGC jobs are linked to a
  // character, so 3D shorts and faceless jobs use the workspace's character.
  const narrator =
    job.character ??
    (await db.character.findFirst({
      where: { workspaceId: job.workspaceId },
      orderBy: { createdAt: "asc" },
    }));

  const result = await renderJob(job, job.scenes, {
    characterRefs: refs,
    regenerate: opts.regenerate,
    onLog: (m) => log(jobId, m),
    voice: narrator
      ? { voiceId: narrator.voiceId, settings: readJson(narrator.voiceSettings, {}) }
      : null,
  });

  await recordSpend(job.workspaceId, estimate, { jobId, note: job.mode });

  const autoApprove = process.env.AUTO_APPROVE === "true";

  await db.calendarJob.update({
    where: { id: jobId },
    data: {
      status: autoApprove ? "ready" : "review",
      videoUrl: result.videoUrl,
      srtUrl: result.srtUrl,
      thumbnailUrl: result.thumbnailUrl,
      voiceUrl: result.voiceUrl,
      error: null,
    },
  });

  // Rebuild this job's asset rows so the library reflects the current render.
  const scenes = await db.scene.findMany({
    where: { jobId },
    orderBy: { order: "asc" },
  });

  await db.asset.deleteMany({ where: { jobId } });
  await db.asset.createMany({
    data: [
      { workspaceId: job.workspaceId, jobId, kind: "video", url: result.videoUrl, meta: JSON.stringify({ seconds: result.durationSeconds }) },
      { workspaceId: job.workspaceId, jobId, kind: "thumbnail", url: result.thumbnailUrl, meta: "{}" },
      { workspaceId: job.workspaceId, jobId, kind: "srt", url: result.srtUrl, meta: "{}" },
      { workspaceId: job.workspaceId, jobId, kind: "audio", url: result.voiceUrl, meta: "{}" },
      ...scenes.flatMap((s) => [
        ...(s.imageUrl
          ? [
              {
                workspaceId: job.workspaceId,
                jobId,
                kind: "image",
                url: s.imageUrl,
                meta: JSON.stringify({ scene: s.order, provider: "higgsfield" }),
              },
            ]
          : []),
        ...(s.clipUrl
          ? [
              {
                workspaceId: job.workspaceId,
                jobId,
                kind: "clip",
                url: s.clipUrl,
                meta: JSON.stringify({
                  scene: s.order,
                  seconds: s.seconds,
                  provider: "higgsfield",
                }),
              },
            ]
          : []),
      ]),
    ],
  });

  await log(jobId, `render complete — ${result.durationSeconds.toFixed(1)}s`);
}

/** Script (if needed) then render. What the worker calls. */
export async function runJob(jobId: string): Promise<void> {
  const job = await db.calendarJob.findUniqueOrThrow({ where: { id: jobId } });
  try {
    if (job.status === "idea") await scriptJob(jobId);
    await renderJobById(jobId);
  } catch (err) {
    const message = (err as Error).message;
    // Best-effort: the row may have been deleted while it was running.
    await log(jobId, message, "error").catch(() => {});
    await db.calendarJob
      .update({
        where: { id: jobId },
        data: { status: "failed", error: message.slice(0, 900) },
      })
      .catch(() => {});
    throw err;
  }
}

export { renderJob };
