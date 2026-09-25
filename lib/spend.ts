/**
 * Spend guard. A weekly USD cap on live Higgsfield generation, enforced before
 * a job renders so a runaway loop or a careless "Fill 7 days" can't burn the
 * whole balance.
 *
 * Estimates only (see lib/pricing.ts) — a seatbelt, not accounting. MOCK spends
 * nothing, so the guard is a no-op there.
 *
 *   SPEND_CAP_USD_PER_WEEK   0 or unset = no cap (a warning is logged in live
 *                            mode). Set it before MOCK=false on a public URL.
 */

import { db } from "./db";
import { isMock } from "./higgsfield";
import { estimateJobUsd, round } from "./pricing";
import { startOfWeek } from "./schedule";

export function weeklyCapUsd(): number {
  const v = Number(process.env.SPEND_CAP_USD_PER_WEEK);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export async function spentThisWeekUsd(workspaceId: string): Promise<number> {
  const since = startOfWeek(new Date());
  const agg = await db.spendLog.aggregate({
    where: { workspaceId, createdAt: { gte: since } },
    _sum: { usd: true },
  });
  return round(agg._sum.usd ?? 0);
}

export type SpendStatus = {
  mock: boolean;
  capUsd: number; // 0 = uncapped
  spentUsd: number;
  remainingUsd: number | null; // null when uncapped
};

export async function spendStatus(workspaceId: string): Promise<SpendStatus> {
  const cap = weeklyCapUsd();
  const spent = isMock() ? 0 : await spentThisWeekUsd(workspaceId);
  return {
    mock: isMock(),
    capUsd: cap,
    spentUsd: spent,
    remainingUsd: cap > 0 ? round(Math.max(0, cap - spent)) : null,
  };
}

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetError";
  }
}

/**
 * Throw if rendering this job would exceed the weekly cap. No-op in MOCK or
 * when uncapped. Call right before the Higgsfield work starts.
 */
export async function assertWithinBudget(
  workspaceId: string,
  scenes: { seconds: number }[],
): Promise<number> {
  const estimate = estimateJobUsd(scenes);
  if (isMock()) return estimate;

  const cap = weeklyCapUsd();
  if (cap <= 0) {
    console.warn(
      "[spend] SPEND_CAP_USD_PER_WEEK is not set — live generation is uncapped.",
    );
    return estimate;
  }

  const spent = await spentThisWeekUsd(workspaceId);
  if (spent + estimate > cap) {
    throw new BudgetError(
      `Weekly spend cap reached: this job is ~$${estimate.toFixed(2)}, ` +
        `already spent ~$${spent.toFixed(2)} of $${cap.toFixed(2)} this week. ` +
        `Raise SPEND_CAP_USD_PER_WEEK or wait for the week to reset.`,
    );
  }
  return estimate;
}

/** Record estimated spend after a successful live render. No-op in MOCK. */
export async function recordSpend(
  workspaceId: string,
  usd: number,
  opts: { jobId?: string; note?: string } = {},
): Promise<void> {
  if (isMock() || usd <= 0) return;
  await db.spendLog.create({
    data: {
      workspaceId,
      jobId: opts.jobId ?? null,
      usd: round(usd),
      note: opts.note ?? "",
    },
  });
}
