import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { isMock } from "@/lib/higgsfield";
import { hasLlm } from "@/lib/llm";
import { ttsProvider } from "@/lib/tts";

export const runtime = "nodejs";

/** Polled by the calendar so job cards move without a page reload. */
export async function GET() {
  const workspace = await getWorkspace();
  const jobs = await db.calendarJob.findMany({
    where: { workspaceId: workspace.id },
    select: {
      id: true,
      status: true,
      title: true,
      videoUrl: true,
      thumbnailUrl: true,
      error: true,
      updatedAt: true,
    },
  });

  const character = await db.character.findFirst({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "asc" },
    select: { name: true, avatarUrl: true },
  });

  const counts: Record<string, number> = {};
  for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;

  return NextResponse.json({
    jobs,
    counts,
    character,
    providers: {
      higgsfield: isMock() ? "mock" : "live",
      scripts: hasLlm() ? "claude" : "template",
      voice: ttsProvider(),
    },
  });
}
