/**
 * The calendar planner behind "Fill next 7 days".
 *
 * Cadence rules say how many of each mode per week. This spreads them across
 * the next seven days, picks a topic per slot, and drops the jobs in as `idea`
 * for the worker to pick up. Days that already have a job for that mode are
 * left alone, so pressing the button twice does not double-book.
 */

import { db, readList } from "./db";
import { suggestZachTopics, TOPIC_BANK } from "@/pipelines/zach";
import { suggestIdeas } from "@/pipelines/faceless";
import { isComingSoon } from "./ui";
import type { Mode } from "@/pipelines/types";

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function startOfWeek(d: Date): Date {
  const out = startOfDay(d);
  const day = (out.getDay() + 6) % 7; // Monday = 0
  return addDays(out, -day);
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Publish times that suit each mode. */
const POST_HOUR: Record<Mode, number> = {
  zach_short: 18,
  ugc_ad: 12,
  faceless_yt: 16,
};

/** Even spread: 3/week -> Mon, Wed, Fri rather than Mon, Tue, Wed. */
export function spreadDays(perWeek: number, days = 7): number[] {
  const n = Math.min(Math.max(perWeek, 0), days);
  if (n === 0) return [];
  if (n >= days) return Array.from({ length: days }, (_, i) => i);
  return Array.from({ length: n }, (_, i) => Math.round((i * days) / n));
}

export type FillResult = {
  created: number;
  skipped: number;
  byMode: Record<string, number>;
};

export async function fillNextDays(params: {
  workspaceId: string;
  from?: Date;
  days?: number;
}): Promise<FillResult> {
  const { workspaceId, from = new Date(), days = 7 } = params;
  const start = startOfDay(from);

  const [rules, brandKit, character] = await Promise.all([
    db.cadenceRule.findMany({ where: { workspaceId, enabled: true } }),
    db.brandKit.findFirst({ where: { workspaceId } }),
    db.character.findFirst({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
  ]);

  const niche = brandKit?.niche || "everyday science";
  const existing = await db.calendarJob.findMany({
    where: { workspaceId, date: { gte: start, lt: addDays(start, days) } },
    select: { date: true, mode: true, topic: true },
  });
  const taken = new Set(existing.map((j) => `${dayKey(j.date)}|${j.mode}`));
  const usedTopics = new Set(existing.map((j) => j.topic.toLowerCase()));

  const result: FillResult = { created: 0, skipped: 0, byMode: {} };

  for (const rule of rules) {
    const mode = rule.mode as Mode;
    if (isComingSoon(mode)) continue; // gated modes are not scheduled
    const offsets = spreadDays(rule.perWeek, days);
    if (!offsets.length) continue;

    const topics = await topicsFor(mode, niche, offsets.length + 4, usedTopics, brandKit);
    let cursor = 0;

    for (const offset of offsets) {
      const date = addDays(start, offset);
      const key = `${dayKey(date)}|${mode}`;
      if (taken.has(key)) {
        result.skipped++;
        continue;
      }

      const topic = topics[cursor++] ?? `${niche} — idea ${cursor}`;
      usedTopics.add(topic.toLowerCase());

      const scheduledAt = new Date(date);
      scheduledAt.setHours(POST_HOUR[mode] ?? 17, 0, 0, 0);

      await db.calendarJob.create({
        data: {
          workspaceId,
          characterId: mode === "ugc_ad" ? character?.id ?? null : null,
          date,
          mode,
          status: "idea",
          topic,
          scheduledAt,
          inputs:
            mode === "ugc_ad"
              ? JSON.stringify({
                  productName: brandKit?.niche || "the product",
                  offer: brandKit?.cta || "",
                })
              : mode === "faceless_yt"
                ? JSON.stringify({ length: "short" })
                : "{}",
        },
      });

      taken.add(key);
      result.created++;
      result.byMode[mode] = (result.byMode[mode] ?? 0) + 1;
    }
  }

  return result;
}

async function topicsFor(
  mode: Mode,
  niche: string,
  count: number,
  used: Set<string>,
  brandKit: { audience: string; tone: string; hookStyle: string; cta: string; bannedPhrases: string } | null,
): Promise<string[]> {
  const brand = brandKit
    ? {
        niche,
        audience: brandKit.audience,
        tone: brandKit.tone,
        hookStyle: brandKit.hookStyle,
        cta: brandKit.cta,
        bannedPhrases: readList(brandKit.bannedPhrases),
      }
    : { niche };

  let pool: string[];
  if (mode === "zach_short") {
    pool = (await suggestZachTopics({ niche, count: count + 4 })).topics;
    if (pool.length < count) pool = [...pool, ...TOPIC_BANK];
  } else if (mode === "faceless_yt") {
    pool = (await suggestIdeas({ niche, count: count + 4, brand })).ideas.map((i) => i.topic);
  } else {
    pool = Array.from({ length: count + 2 }, (_, i) =>
      i === 0 ? `${niche} — hero angle` : `${niche} — angle ${i + 1}`,
    );
  }

  const fresh = pool.filter((t) => !used.has(t.toLowerCase()));
  return fresh.length >= count ? fresh : [...fresh, ...pool];
}
