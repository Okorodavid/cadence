import Link from "next/link";
import { db, readList } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { MODE_META, STATUS_META, fmtDateLong, fmtTime } from "@/lib/ui";
import type { JobStatus, Mode } from "@/pipelines/types";

export const dynamic = "force-dynamic";

export default async function ExportPage() {
  const workspace = await getWorkspace();

  const jobs = await db.calendarJob.findMany({
    where: { workspaceId: workspace.id, videoUrl: { not: null } },
    orderBy: [{ date: "desc" }, { scheduledAt: "asc" }],
    take: 60,
  });

  // Group by day so "download the day's pack" is one click.
  const byDay = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const key = job.date.toISOString().slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), job]);
  }

  return (
    <div className="py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Export</h1>
        <p className="mt-1 text-sm text-muted">
          Each pack is an mp4, an srt, a thumbnail, the title, description, tags, the
          scheduled time, and a publish checklist. Upload is manual for now — by design.
        </p>
      </div>

      {!byDay.size && (
        <div className="card grid place-items-center p-16 text-center">
          <div className="max-w-sm">
            <p className="text-sm text-muted">
              Nothing rendered yet.{" "}
              <Link href="/calendar" className="text-accent underline">
                Fill the calendar
              </Link>{" "}
              and the finished jobs land here.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-8">
        {[...byDay.entries()].map(([day, dayJobs]) => (
          <section key={day}>
            <div className="mb-3 flex items-baseline justify-between border-b border-line pb-2">
              <h2 className="text-sm font-semibold">
                {fmtDateLong(new Date(day))}
                <span className="ml-2 text-xs font-normal text-faint">
                  {dayJobs.length} piece{dayJobs.length === 1 ? "" : "s"}
                </span>
              </h2>
              <a href={`/api/export?date=${day}`} className="btn btn-sm">
                Download day pack
              </a>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {dayJobs.map((job) => {
                const mode = MODE_META[job.mode as Mode];
                const status = STATUS_META[job.status as JobStatus] ?? STATUS_META.idea;
                const tags = readList(job.tags);
                return (
                  <article key={job.id} className="card overflow-hidden">
                    <Link href={`/jobs/${job.id}`}>
                      {job.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={job.thumbnailUrl}
                          alt=""
                          className="aspect-video w-full object-cover"
                        />
                      ) : (
                        <div className="aspect-video w-full bg-raise" />
                      )}
                    </Link>

                    <div className="p-3">
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="flex items-center gap-1 text-[10px] tracking-wider text-faint uppercase">
                          <span className={`h-1.5 w-1.5 rounded-full ${mode?.dot}`} />
                          {mode?.short}
                        </span>
                        <span className={`chip ${status.className}`}>{status.label}</span>
                        <span className="ml-auto text-[10px] text-faint">
                          {fmtTime(job.scheduledAt)}
                        </span>
                      </div>

                      <Link
                        href={`/jobs/${job.id}`}
                        className="line-clamp-2 text-[13px] leading-snug font-medium hover:text-accent"
                      >
                        {job.title || job.topic}
                      </Link>

                      {tags.length > 0 && (
                        <p className="mt-1.5 line-clamp-1 text-[10px] text-faint">
                          {tags.slice(0, 6).join(" · ")}
                        </p>
                      )}

                      <div className="mt-3 flex gap-1.5">
                        <a
                          href={`/api/jobs/${job.id}/export`}
                          className="btn btn-sm flex-1 justify-center"
                        >
                          Pack
                        </a>
                        {job.videoUrl && (
                          <a
                            href={job.videoUrl}
                            download
                            className="btn btn-sm flex-1 justify-center"
                          >
                            mp4
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
