import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { enqueue } from "@/lib/queue";
import { checkTopic } from "@/lib/prompts";
import { startOfDay } from "@/lib/schedule";
import { MODE_META, isComingSoon } from "@/lib/ui";

export const runtime = "nodejs";

const CreateSchema = z.object({
  mode: z.enum(["ugc_ad", "faceless_yt", "zach_short"]),
  topic: z.string().min(1),
  date: z.string().optional(),
  characterId: z.string().optional(),
  inputs: z.record(z.unknown()).optional(),
  run: z.boolean().default(false),
});

export async function POST(req: Request) {
  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const body = parsed.data;

  if (isComingSoon(body.mode)) {
    return NextResponse.json(
      { error: `${MODE_META[body.mode].label} is coming soon.` },
      { status: 422 },
    );
  }

  const guard = checkTopic(body.topic);
  if (!guard.ok) return NextResponse.json({ error: guard.reason }, { status: 422 });

  const workspace = await getWorkspace();
  const date = startOfDay(body.date ? new Date(body.date) : new Date());
  const scheduledAt = new Date(date);
  scheduledAt.setHours(body.mode === "zach_short" ? 18 : body.mode === "ugc_ad" ? 12 : 16, 0, 0, 0);

  const character =
    body.characterId ??
    (body.mode === "ugc_ad"
      ? (
          await db.character.findFirst({
            where: { workspaceId: workspace.id },
            orderBy: { createdAt: "asc" },
          })
        )?.id
      : undefined);

  const job = await db.calendarJob.create({
    data: {
      workspaceId: workspace.id,
      characterId: character ?? null,
      mode: body.mode,
      topic: body.topic,
      date,
      scheduledAt,
      status: "idea",
      inputs: JSON.stringify(body.inputs ?? {}),
    },
  });

  if (body.run) await enqueue(job.id);

  return NextResponse.json({ job });
}
