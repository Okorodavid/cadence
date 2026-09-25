import { NextResponse } from "next/server";
import { z } from "zod";
import { db, readList } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { suggestIdeas } from "@/pipelines/faceless";
import { suggestZachTopics } from "@/pipelines/zach";
import { addDays, startOfDay } from "@/lib/schedule";
import { enqueue } from "@/lib/queue";
import { checkTopic } from "@/lib/prompts";
import { MODE_META, isComingSoon } from "@/lib/ui";

export const runtime = "nodejs";
export const maxDuration = 120;

const Schema = z.object({
  mode: z.enum(["ugc_ad", "faceless_yt", "zach_short"]).default("faceless_yt"),
  niche: z.string().default(""),
  competitorTitles: z.array(z.string()).default([]),
  count: z.number().min(1).max(20).default(10),
});

/** Topic picker: a niche, or 3 competitor titles, into 10 ideas with hooks. */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { mode, competitorTitles, count } = parsed.data;

  if (isComingSoon(mode)) {
    return NextResponse.json(
      { error: `${MODE_META[mode].label} is coming soon.` },
      { status: 422 },
    );
  }

  const workspace = await getWorkspace();
  const kit = await db.brandKit.findFirst({ where: { workspaceId: workspace.id } });
  const niche = parsed.data.niche || kit?.niche || "everyday science";

  if (mode === "zach_short") {
    const { topics, source } = await suggestZachTopics({ niche, count });
    return NextResponse.json({
      source,
      ideas: topics.map((t) => ({ topic: t, title: t, hook: "", why: "" })),
    });
  }

  const { ideas, source } = await suggestIdeas({
    niche,
    competitorTitles: competitorTitles.filter(Boolean),
    count,
    brand: {
      niche,
      audience: kit?.audience,
      tone: kit?.tone,
      hookStyle: kit?.hookStyle,
      cta: kit?.cta,
      bannedPhrases: readList(kit?.bannedPhrases),
    },
  });

  return NextResponse.json({ ideas, source });
}

const ScheduleSchema = z.object({
  mode: z.enum(["ugc_ad", "faceless_yt", "zach_short"]),
  ideas: z.array(z.object({ topic: z.string().min(1), title: z.string().default("") })).min(1),
  startDate: z.string().optional(),
  spacingDays: z.number().min(1).max(7).default(1),
  run: z.boolean().default(false),
});

/** Turn the picked ideas into calendar jobs, one every `spacingDays`. */
export async function PUT(req: Request) {
  const parsed = ScheduleSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { mode, ideas, spacingDays, run } = parsed.data;

  if (isComingSoon(mode)) {
    return NextResponse.json(
      { error: `${MODE_META[mode].label} is coming soon.` },
      { status: 422 },
    );
  }

  const workspace = await getWorkspace();
  const start = startOfDay(
    parsed.data.startDate ? new Date(parsed.data.startDate) : new Date(),
  );
  const character =
    mode === "ugc_ad"
      ? await db.character.findFirst({
          where: { workspaceId: workspace.id },
          orderBy: { createdAt: "asc" },
        })
      : null;

  const created: string[] = [];
  const rejected: string[] = [];

  for (const [i, idea] of ideas.entries()) {
    const guard = checkTopic(idea.topic);
    if (!guard.ok) {
      rejected.push(`${idea.topic}: ${guard.reason}`);
      continue;
    }

    const date = addDays(start, i * spacingDays);
    const scheduledAt = new Date(date);
    scheduledAt.setHours(mode === "zach_short" ? 18 : mode === "ugc_ad" ? 12 : 16, 0, 0, 0);

    const job = await db.calendarJob.create({
      data: {
        workspaceId: workspace.id,
        characterId: character?.id ?? null,
        mode,
        topic: idea.topic,
        title: idea.title || "",
        date,
        scheduledAt,
        status: "idea",
        inputs: mode === "faceless_yt" ? JSON.stringify({ length: "short" }) : "{}",
      },
    });
    created.push(job.id);
  }

  if (run) {
    for (const id of created.slice(0, 4)) await enqueue(id);
  }

  return NextResponse.json({ created: created.length, rejected });
}
