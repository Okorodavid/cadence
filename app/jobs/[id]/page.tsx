import Link from "next/link";
import { notFound } from "next/navigation";
import { db, readJson, readList } from "@/lib/db";
import { JobDetail } from "@/components/job-detail";

export const dynamic = "force-dynamic";

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const job = await db.calendarJob.findUnique({
    where: { id },
    include: {
      scenes: { orderBy: { order: "asc" } },
      logs: { orderBy: { createdAt: "desc" }, take: 30 },
      character: true,
    },
  });
  if (!job) notFound();

  const inputs = readJson<{ captionVariants?: string[]; productName?: string; offer?: string }>(
    job.inputs,
    {},
  );

  return (
    <>
      <div className="pt-6 pb-4">
        <Link href="/calendar" className="text-xs text-muted hover:text-fg">
          ← Calendar
        </Link>
      </div>

      <JobDetail
        job={{
          id: job.id,
          mode: job.mode,
          status: job.status,
          title: job.title,
          topic: job.topic,
          hook: job.hook,
          caption: job.caption,
          description: job.description,
          tags: readList(job.tags),
          videoUrl: job.videoUrl,
          thumbnailUrl: job.thumbnailUrl,
          srtUrl: job.srtUrl,
          voiceUrl: job.voiceUrl,
          error: job.error,
          date: job.date.toISOString(),
          scheduledAt: job.scheduledAt?.toISOString() ?? null,
          captionVariants: inputs.captionVariants ?? [],
          characterName: job.character?.name ?? null,
          characterAvatar: job.character?.avatarUrl ?? null,
        }}
        scenes={job.scenes.map((s) => ({
          id: s.id,
          order: s.order,
          seconds: s.seconds,
          narration: s.narration,
          visualPrompt: s.visualPrompt,
          camera: s.camera,
          onScreenText: s.onScreenText,
          imageUrl: s.imageUrl,
          clipUrl: s.clipUrl,
          status: s.status,
          error: s.error,
        }))}
        logs={job.logs.map((l) => ({
          id: l.id,
          level: l.level,
          message: l.message,
          at: l.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
