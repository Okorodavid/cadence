/**
 * The job runner. `npm run worker`.
 *
 * Polls the jobs table, claims one job at a time with a lock so two workers
 * never grab the same row, and walks it idea -> ... -> review/ready. Anything
 * that throws is written back as `failed` with the error on the row.
 *
 *   npm run worker        watch mode, runs forever
 *   npm run worker:once   drain the queue and exit (CI / demo prep)
 */

import { loadEnv } from "../lib/env";
loadEnv();

import { db } from "../lib/db";
import { runJob } from "../pipelines";
import { hasFfmpeg } from "../lib/ffmpeg";
import { isMock } from "../lib/higgsfield";
import { hasLlm } from "../lib/llm";
import { ttsProvider } from "../lib/tts";

const POLL_MS = Number.parseInt(process.env.WORKER_POLL_MS ?? "3000", 10);
/** A job locked longer than this is assumed dead and gets retried. */
const LOCK_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = Number.parseInt(process.env.WORKER_MAX_ATTEMPTS ?? "3", 10);

const RUNNABLE = ["idea", "scripted"];

let stopping = false;

async function claimNext() {
  const staleBefore = new Date(Date.now() - LOCK_TTL_MS);

  const candidate = await db.calendarJob.findFirst({
    where: {
      status: { in: RUNNABLE },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  if (!candidate) return null;

  // Conditional update = the lock. If another worker got there first the
  // count comes back 0 and we just try again next tick.
  const claimed = await db.calendarJob.updateMany({
    where: {
      id: candidate.id,
      status: candidate.status,
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
    },
    data: { lockedAt: new Date(), attempts: { increment: 1 } },
  });

  return claimed.count === 1 ? candidate : null;
}

async function tick(): Promise<boolean> {
  const job = await claimNext();
  if (!job) return false;

  const started = Date.now();
  console.log(`\n▶ ${job.mode} · ${job.topic || job.title || job.id}`);
  try {
    await runJob(job.id);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const after = await db.calendarJob.findUnique({ where: { id: job.id } });
    console.log(`✔ ${after?.status} in ${secs}s — ${after?.title || job.topic}`);
  } catch (err) {
    console.error(`✖ failed: ${(err as Error).message}`);
  } finally {
    // The job may have been deleted meanwhile — never let that kill the loop.
    await db.calendarJob
      .update({ where: { id: job.id }, data: { lockedAt: null } })
      .catch(() => {});
  }
  return true;
}

async function main() {
  const once = process.argv.includes("--once");

  console.log("Cadence worker");
  console.log(`  higgsfield : ${isMock() ? "MOCK (ffmpeg, $0)" : "LIVE"}`);
  console.log(`  scripts    : ${hasLlm() ? "Claude" : "template fallback"}`);
  console.log(`  voice      : ${ttsProvider()}`);
  console.log(`  ffmpeg     : ${(await hasFfmpeg()) ? "ok" : "MISSING — renders will fail"}`);
  console.log(`  mode       : ${once ? "drain once" : "watch"}\n`);

  if (once) {
    let n = 0;
    while (await tick()) n++;
    console.log(`\nDrained ${n} job${n === 1 ? "" : "s"}.`);
    await db.$disconnect();
    return;
  }

  console.log("Waiting for jobs… (ctrl+c to stop)");
  while (!stopping) {
    const did = await tick();
    if (!did) await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await db.$disconnect();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log("\nFinishing current job, then stopping…");
  });
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
