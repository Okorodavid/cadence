import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; sceneId: string }> };

const PatchSchema = z.object({
  narration: z.string().optional(),
  visualPrompt: z.string().optional(),
  camera: z.string().optional(),
  onScreenText: z.string().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const { sceneId } = await params;
  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const scene = await db.scene.update({ where: { id: sceneId }, data: parsed.data });
  return NextResponse.json({ scene });
}

/**
 * Re-shoot one beat. Clears its media so the renderer regenerates only this
 * scene, then re-runs the job — everything else is reused from disk.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id, sceneId } = await params;

  const scene = await db.scene.findUnique({ where: { id: sceneId } });
  if (!scene || scene.jobId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.scene.update({
    where: { id: sceneId },
    data: { imageUrl: null, clipUrl: null, status: "pending", error: null },
  });
  await db.calendarJob.update({
    where: { id },
    data: { status: "scripted", attempts: 0, error: null },
  });

  const result = await enqueue(id);
  return NextResponse.json(result, { status: result.started ? 202 : 409 });
}
