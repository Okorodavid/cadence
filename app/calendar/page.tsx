import { db, readList } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/workspace";
import { addDays, startOfWeek } from "@/lib/schedule";
import { spendStatus } from "@/lib/spend";
import { CalendarWeek, type CalendarJobView } from "@/components/calendar-week";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const { w } = await searchParams;
  const offset = Number.parseInt(w ?? "0", 10) || 0;

  const { workspace, brandKit, character, cadences } = await getWorkspaceContext();

  const weekStart = addDays(startOfWeek(new Date()), offset * 7);
  const weekEnd = addDays(weekStart, 7);

  const jobs = await db.calendarJob.findMany({
    where: { workspaceId: workspace.id, date: { gte: weekStart, lt: weekEnd } },
    orderBy: [{ date: "asc" }, { scheduledAt: "asc" }],
    include: { _count: { select: { scenes: true } } },
  });

  const views: CalendarJobView[] = jobs.map((j) => ({
    id: j.id,
    mode: j.mode,
    status: j.status,
    title: j.title,
    topic: j.topic,
    hook: j.hook,
    thumbnailUrl: j.thumbnailUrl,
    videoUrl: j.videoUrl,
    error: j.error,
    sceneCount: j._count.scenes,
    date: j.date.toISOString(),
    scheduledAt: j.scheduledAt?.toISOString() ?? null,
  }));

  const totals = await db.calendarJob.groupBy({
    by: ["status"],
    where: { workspaceId: workspace.id },
    _count: true,
  });

  const spend = await spendStatus(workspace.id);

  return (
    <CalendarWeek
      weekStartIso={weekStart.toISOString()}
      offset={offset}
      jobs={views}
      spend={spend}
      totals={Object.fromEntries(totals.map((t) => [t.status, t._count]))}
      cadences={cadences.map((c) => ({ mode: c.mode, perWeek: c.perWeek, enabled: c.enabled }))}
      character={
        character
          ? {
              name: character.name,
              avatarUrl: character.avatarUrl,
              lookbook: readList(character.lookbookImageUrls),
              soulId: character.soulId,
            }
          : null
      }
      niche={brandKit?.niche ?? ""}
    />
  );
}
