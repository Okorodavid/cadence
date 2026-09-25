import { NextResponse } from "next/server";
import { z } from "zod";
import { db, writeList } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { normalizeVoiceSettings } from "@/lib/voice-presets";

export const runtime = "nodejs";

const Schema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).optional(),
  styleNotes: z.string().optional(),
  voiceId: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  sourceImageUrls: z.array(z.string()).optional(),
  voiceSettings: z
    .object({
      preset: z.string().optional(),
      speed: z.number().optional(),
      pitch: z.number().optional(),
      stability: z.number().optional(),
      style: z.number().optional(),
    })
    .optional(),
});

export async function PUT(req: Request) {
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { id, sourceImageUrls, voiceSettings, ...rest } = parsed.data;
  const workspace = await getWorkspace();

  const data = {
    ...rest,
    ...(sourceImageUrls ? { sourceImageUrls: writeList(sourceImageUrls) } : {}),
    ...(voiceSettings ? { voiceSettings: JSON.stringify(normalizeVoiceSettings(voiceSettings)) } : {}),
  };

  const target =
    (id && (await db.character.findUnique({ where: { id } }))) ||
    (await db.character.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
    }));

  const character = target
    ? await db.character.update({ where: { id: target.id }, data })
    : await db.character.create({
        data: {
          workspaceId: workspace.id,
          name: rest.name ?? "Untitled",
          ...data,
        },
      });

  return NextResponse.json({ character });
}
