import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";
import { addDays, fillNextDays, startOfDay } from "@/lib/schedule";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue";

export const runtime = "nodejs";
export const maxDuration = 300;

/** "Fill next 7 days" — creates the jobs, optionally starts rendering them. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    days?: number;
    from?: string;
    run?: boolean;
  };

  const workspace = await getWorkspace();
  const days = body.days ?? 7;

  // "Fill 1 day" should land on the next day that has no jobs, not silently do
  // nothing when today is already full. Scan up to two weeks ahead.
  let from = body.from ? new Date(body.from) : undefined;
  if (days === 1 && !from) {
    const today = startOfDay(new Date());
    for (let i = 0; i < 14; i++) {
      const day = addDays(today, i);
      const count = await db.calendarJob.count({
        where: { workspaceId: workspace.id, date: { gte: day, lt: addDays(day, 1) } },
      });
      if (count === 0) {
        from = day;
        break;
      }
    }
    from ??= today;
  }

  const result = await fillNextDays({
    workspaceId: workspace.id,
    days,
    from,
  });

  if (body.run && result.created) {
    const pending = await db.calendarJob.findMany({
      where: { workspaceId: workspace.id, status: "idea" },
      orderBy: { date: "asc" },
      take: 4, // don't stampede — the worker drains the rest
    });
    for (const job of pending) await enqueue(job.id);
  }

  return NextResponse.json(result);
}
