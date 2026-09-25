/**
 * Demo prep. `npm run demo`
 *
 * Renders everything still queued, then approves most of it so the calendar
 * reads like a workspace that has been running for a week rather than one that
 * was seeded a minute ago. A couple of jobs are left in review on purpose —
 * that is the screen where you show approve / regenerate.
 *
 * Re-running is cheap: stills and clips are cached on disk, so a second pass
 * only redoes the stitch, the caption burn and the packaging.
 */

import { loadEnv } from "../lib/env";
loadEnv();

import { db } from "../lib/db";
import { runJob } from "../pipelines";
import { hasFfmpeg } from "../lib/ffmpeg";
import { isMock } from "../lib/higgsfield";
import { hasLlm } from "../lib/llm";
import { ttsProvider } from "../lib/tts";
import { removeDir } from "../lib/storage";
import { buildLookbook } from "../pipelines/character";

const LEAVE_IN_REVIEW = 2;

async function main() {
  const fresh = process.argv.includes("--fresh");
  const rerender = process.argv.includes("--rerender") || fresh;

  console.log("Cadence demo prep");
  console.log(`  higgsfield : ${isMock() ? "MOCK (ffmpeg, $0)" : "LIVE"}`);
  console.log(`  scripts    : ${hasLlm() ? "Claude" : "template fallback"}`);
  console.log(`  voice      : ${ttsProvider()}`);
  if (!(await hasFfmpeg())) {
    console.error("\nffmpeg is not on PATH — nothing can render. Install it first.");
    process.exit(1);
  }

  if (fresh) {
    // Throw away every generated pixel and start over. In MOCK that costs
    // nothing but time; with live keys it re-spends the whole week, so it is
    // opt-in rather than the default.
    if (!isMock()) {
      console.warn(
        "\n  --fresh with LIVE keys regenerates every asset and will spend credits.",
      );
    }
    await removeDir("mock");
    const cleared = await db.scene.updateMany({
      data: { imageUrl: null, clipUrl: null, audioUrl: null, status: "pending", error: null },
    });
    console.log(`\n  cleared cached media on ${cleared.count} scene(s)`);

    const character = await db.character.findFirst({ orderBy: { createdAt: "asc" } });
    if (character) {
      await buildLookbook({ characterId: character.id });
      console.log("  look book regenerated");
    }
  }

  if (rerender) {
    // Force every finished job back through assembly (new caption style,
    // new thumbnail logic) without regenerating a single Higgsfield asset.
    // `rendering` is included so a row left in flight by a crashed or killed
    // run is recovered rather than sitting there forever.
    const reset = await db.calendarJob.updateMany({
      where: { status: { in: ["review", "ready", "rendering"] } },
      data: { status: "scripted", attempts: 0, lockedAt: null, error: null },
    });
    console.log(`\n  re-rendering ${reset.count} finished job(s) from cached assets`);
  }

  const queued = await db.calendarJob.findMany({
    where: { status: { in: ["idea", "scripted", "failed"] } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  console.log(`\n${queued.length} job(s) to render\n`);

  const LOCK_TTL_MS = 30 * 60 * 1000;

  for (const [i, job] of queued.entries()) {
    const started = Date.now();
    process.stdout.write(
      `[${i + 1}/${queued.length}] ${job.mode} · ${job.topic.slice(0, 50)} … `,
    );

    // Same lock the worker uses. Two renderers on one job trample each
    // other's media and leave rows pointing at files that no longer exist.
    const claimed = await db.calendarJob.updateMany({
      where: {
        id: job.id,
        OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - LOCK_TTL_MS) } }],
      },
      data: { lockedAt: new Date(), attempts: 0 },
    });
    if (claimed.count !== 1) {
      console.log("skipped — another worker holds it");
      continue;
    }

    try {
      await runJob(job.id);
      console.log(`ok (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    } catch (err) {
      console.log(`FAILED — ${(err as Error).message.slice(0, 120)}`);
    } finally {
      await db.calendarJob
        .update({ where: { id: job.id }, data: { lockedAt: null } })
        .catch(() => {});
    }
  }

  // Approve everything with a render, except the newest few.
  const rendered = await db.calendarJob.findMany({
    where: { status: "review", videoUrl: { not: null } },
    orderBy: { date: "asc" },
  });
  const toApprove = rendered.slice(0, Math.max(0, rendered.length - LEAVE_IN_REVIEW));
  if (toApprove.length) {
    await db.calendarJob.updateMany({
      where: { id: { in: toApprove.map((j) => j.id) } },
      data: { status: "ready" },
    });
  }

  const counts = await db.calendarJob.groupBy({ by: ["status"], _count: true });
  console.log(
    `\nCalendar: ${counts.map((c) => `${c._count} ${c.status}`).join(", ")}`,
  );
  console.log("Run `npm run dev` and open http://localhost:3000\n");

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
