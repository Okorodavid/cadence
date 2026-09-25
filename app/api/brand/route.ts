import { NextResponse } from "next/server";
import { z } from "zod";
import { db, writeList } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

const Schema = z.object({
  niche: z.string().optional(),
  audience: z.string().optional(),
  tone: z.string().optional(),
  rpmCategory: z.string().optional(),
  hookStyle: z.string().optional(),
  cta: z.string().optional(),
  bannedPhrases: z.array(z.string()).optional(),
  colors: z.array(z.string()).optional(),
  cadences: z
    .array(z.object({ mode: z.string(), perWeek: z.number().min(0).max(14) }))
    .optional(),
});

export async function PUT(req: Request) {
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { bannedPhrases, colors, cadences, ...rest } = parsed.data;
  const workspace = await getWorkspace();

  const data = {
    ...rest,
    ...(bannedPhrases ? { bannedPhrases: writeList(bannedPhrases) } : {}),
    ...(colors ? { colors: writeList(colors) } : {}),
  };

  const existing = await db.brandKit.findFirst({ where: { workspaceId: workspace.id } });
  const brandKit = existing
    ? await db.brandKit.update({ where: { id: existing.id }, data })
    : await db.brandKit.create({ data: { ...data, workspaceId: workspace.id } });

  if (cadences) {
    for (const c of cadences) {
      const rule = await db.cadenceRule.findFirst({
        where: { workspaceId: workspace.id, mode: c.mode },
      });
      if (rule) {
        await db.cadenceRule.update({
          where: { id: rule.id },
          data: { perWeek: c.perWeek, enabled: c.perWeek > 0 },
        });
      } else {
        await db.cadenceRule.create({
          data: {
            workspaceId: workspace.id,
            mode: c.mode,
            perWeek: c.perWeek,
            enabled: c.perWeek > 0,
          },
        });
      }
    }
  }

  return NextResponse.json({ brandKit });
}
