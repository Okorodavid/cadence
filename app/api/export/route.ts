import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { addJobToArchive, slugify, streamZip } from "@/lib/export";
import { addDays, startOfDay } from "@/lib/schedule";

export const runtime = "nodejs";

/**
 * Day pack: every ready/review job on a date, one folder each.
 *   GET /api/export?date=2026-09-21
 *   GET /api/export?ids=a,b,c
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean);
  const dateParam = url.searchParams.get("date");
  const workspace = await getWorkspace();

  const day = startOfDay(dateParam ? new Date(dateParam) : new Date());
  const jobs = await db.calendarJob.findMany({
    where: ids?.length
      ? { id: { in: ids } }
      : {
          workspaceId: workspace.id,
          date: { gte: day, lt: addDays(day, 1) },
          videoUrl: { not: null },
        },
    include: { scenes: { orderBy: { order: "asc" } } },
    orderBy: { scheduledAt: "asc" },
  });

  if (!jobs.length) {
    return NextResponse.json(
      { error: "Nothing rendered to export for that selection" },
      { status: 404 },
    );
  }

  const name = ids?.length
    ? `cadence-pack-${jobs.length}.zip`
    : `cadence-${day.toISOString().slice(0, 10)}.zip`;

  const stream = streamZip(async (archive) => {
    for (const job of jobs) {
      await addJobToArchive(archive, job, slugify(job.title || job.topic));
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
