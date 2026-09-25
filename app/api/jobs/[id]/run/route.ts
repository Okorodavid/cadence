import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Run (or re-run) a job.
 *   { "rescript": true }        throw the script away and start from the topic
 *   { "regenerate": [3, 5] }    keep the script, re-shoot those beats
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    rescript?: boolean;
    regenerate?: number[];
  };

  const job = await db.calendarJob.findUnique({
    where: { id },
    include: { scenes: true },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.rescript || !job.scenes.length) {
    await db.calendarJob.update({
      where: { id },
      data: { status: "idea", attempts: 0, error: null },
    });
  } else {
    // Clear the media on the beats we want re-shot so the renderer redoes them.
    if (body.regenerate?.length) {
      await db.scene.updateMany({
        where: { jobId: id, order: { in: body.regenerate } },
        data: { imageUrl: null, clipUrl: null, status: "pending", error: null },
      });
    }
    await db.calendarJob.update({
      where: { id },
      data: { status: "scripted", attempts: 0, error: null },
    });
  }

  const result = await enqueue(id);
  return NextResponse.json(result, { status: result.started ? 202 : 409 });
}
