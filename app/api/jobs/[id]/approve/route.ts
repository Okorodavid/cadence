import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Review -> ready, or ready -> scheduled (marks the publish slot as booked). */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: "approve" | "unapprove" | "schedule";
    scheduledAt?: string;
  };
  const action = body.action ?? "approve";

  const job = await db.calendarJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "approve" && !job.videoUrl) {
    return NextResponse.json(
      { error: "Nothing to approve — this job has no render yet" },
      { status: 409 },
    );
  }

  const updated = await db.calendarJob.update({
    where: { id },
    data:
      action === "approve"
        ? { status: "ready" }
        : action === "unapprove"
          ? { status: "review" }
          : { scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : new Date() },
  });

  return NextResponse.json({ job: updated });
}
