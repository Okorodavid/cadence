/**
 * In-process job runner for the UI. The standalone worker is the real queue;
 * this exists so clicking Run in the app does something even when nobody
 * started `npm run worker`.
 *
 * Both take the same DB lock, so a job never runs twice.
 */

import { db } from "./db";
import { runJob } from "@/pipelines";

const LOCK_TTL_MS = 30 * 60 * 1000;
const inFlight = new Set<string>();

export type EnqueueResult = { started: boolean; reason?: string };

export async function enqueue(jobId: string): Promise<EnqueueResult> {
  if (inFlight.has(jobId)) return { started: false, reason: "already running here" };

  const staleBefore = new Date(Date.now() - LOCK_TTL_MS);
  const claimed = await db.calendarJob.updateMany({
    where: {
      id: jobId,
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
    },
    data: { lockedAt: new Date(), attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    return { started: false, reason: "a worker already holds this job" };
  }

  inFlight.add(jobId);
  // Deliberately not awaited: the route returns immediately and the calendar
  // polls for status.
  void (async () => {
    try {
      await runJob(jobId);
    } catch (err) {
      console.error(`[queue] ${jobId} failed:`, (err as Error).message);
    } finally {
      inFlight.delete(jobId);
      await db.calendarJob
        .update({ where: { id: jobId }, data: { lockedAt: null } })
        .catch(() => {});
    }
  })();

  return { started: true };
}

export function isRunningHere(jobId: string): boolean {
  return inFlight.has(jobId);
}
