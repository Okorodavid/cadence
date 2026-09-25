import { NextResponse } from "next/server";
import { z } from "zod";
import { db, writeList } from "@/lib/db";
import { removeDir } from "@/lib/storage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const job = await db.calendarJob.findUnique({
    where: { id },
    include: {
      scenes: { orderBy: { order: "asc" } },
      logs: { orderBy: { createdAt: "desc" }, take: 40 },
      character: true,
    },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job });
}

const PatchSchema = z.object({
  title: z.string().optional(),
  topic: z.string().optional(),
  caption: z.string().optional(),
  description: z.string().optional(),
  hook: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z
    .enum(["idea", "scripted", "rendering", "review", "ready", "failed"])
    .optional(),
  scheduledAt: z.string().nullable().optional(),
  date: z.string().optional(),
  scenes: z
    .array(
      z.object({
        id: z.string(),
        narration: z.string().optional(),
        visualPrompt: z.string().optional(),
        camera: z.string().optional(),
        onScreenText: z.string().optional(),
      }),
    )
    .optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { scenes, tags, scheduledAt, date, ...rest } = parsed.data;

  const job = await db.calendarJob.update({
    where: { id },
    data: {
      ...rest,
      ...(tags ? { tags: writeList(tags) } : {}),
      ...(scheduledAt !== undefined
        ? { scheduledAt: scheduledAt ? new Date(scheduledAt) : null }
        : {}),
      ...(date ? { date: new Date(date) } : {}),
    },
  });

  if (scenes?.length) {
    await Promise.all(
      scenes.map((s) =>
        db.scene.update({
          where: { id: s.id },
          data: {
            ...(s.narration !== undefined ? { narration: s.narration } : {}),
            ...(s.visualPrompt !== undefined ? { visualPrompt: s.visualPrompt } : {}),
            ...(s.camera !== undefined ? { camera: s.camera } : {}),
            ...(s.onScreenText !== undefined ? { onScreenText: s.onScreenText } : {}),
          },
        }),
      ),
    );
  }

  return NextResponse.json({ job });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const job = await db.calendarJob.findUnique({
    where: { id },
    select: { status: true, lockedAt: true },
  });
  if (!job) return NextResponse.json({ ok: true }); // already gone

  // A worker holding this job would crash writing results to a deleted row and
  // keep spending on its remaining scenes. Make the user wait for it to land.
  // Only a fresh lock counts: a crashed worker can leave `rendering` or an old
  // lock behind, and those rows must stay deletable (same 30-min TTL as workers).
  const LOCK_TTL_MS = 30 * 60 * 1000;
  const locked = job.lockedAt && Date.now() - job.lockedAt.getTime() < LOCK_TTL_MS;
  if (locked) {
    return NextResponse.json(
      { error: "This job is rendering right now. Delete it once it finishes." },
      { status: 409 },
    );
  }

  await db.calendarJob.delete({ where: { id } });
  await removeDir(`jobs/${id}`);
  return NextResponse.json({ ok: true });
}
