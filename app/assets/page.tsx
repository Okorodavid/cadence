import Link from "next/link";
import { db, readJson } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { fmtClock, fmtDateLong, secondsLabel } from "@/lib/ui";

export const dynamic = "force-dynamic";

const KINDS = [
  { key: "video", label: "Videos" },
  { key: "image", label: "Stills" },
  { key: "clip", label: "Clips" },
  { key: "thumbnail", label: "Thumbnails" },
  { key: "audio", label: "Audio" },
  { key: "srt", label: "Captions" },
] as const;

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const workspace = await getWorkspace();

  const [assets, counts, character] = await Promise.all([
    db.asset.findMany({
      where: { workspaceId: workspace.id, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: "desc" },
      take: 120,
      include: { job: { select: { id: true, title: true, topic: true, mode: true } } },
    }),
    db.asset.groupBy({
      by: ["kind"],
      where: { workspaceId: workspace.id },
      _count: true,
    }),
    db.character.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const countFor = (k: string) => counts.find((c) => c.kind === k)?._count ?? 0;
  const total = counts.reduce((a, c) => a + c._count, 0);

  return (
    <div className="py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
        <p className="mt-1 text-sm text-muted">
          Everything the pipeline has produced. Images and clips come from Higgsfield;
          audio, captions and the final cuts are assembled locally.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        <FilterLink href="/assets" label="All" count={total} active={!kind} />
        {KINDS.map((k) => (
          <FilterLink
            key={k.key}
            href={`/assets?kind=${k.key}`}
            label={k.label}
            count={countFor(k.key)}
            active={kind === k.key}
          />
        ))}
        {character && (
          <span className="ml-auto text-[11px] text-faint">
            look book lives on the{" "}
            <Link href="/character" className="underline hover:text-muted">
              character
            </Link>{" "}
            page
          </span>
        )}
      </div>

      {!assets.length ? (
        <div className="card grid place-items-center p-16 text-center">
          <p className="max-w-sm text-sm text-muted">
            Nothing here yet.{" "}
            <Link href="/calendar" className="text-accent underline">
              Fill the calendar
            </Link>{" "}
            and assets land here as jobs render.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {assets.map((asset) => {
            const meta = readJson<{ seconds?: number }>(asset.meta, {});
            const isVisual = asset.kind === "video" || asset.kind === "clip";
            return (
              <figure key={asset.id} className="card overflow-hidden">
                {isVisual ? (
                  <video
                    src={asset.url}
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    className="aspect-[9/16] w-full bg-black object-cover"
                    controls
                  />
                ) : asset.kind === "image" || asset.kind === "thumbnail" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={asset.url} alt="" className="aspect-[9/16] w-full object-cover" />
                ) : (
                  <div className="grid aspect-[9/16] w-full place-items-center bg-raise px-3 text-center">
                    <span className="font-mono text-[10px] text-faint">
                      {asset.kind.toUpperCase()}
                    </span>
                  </div>
                )}

                <figcaption className="p-2.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="chip bg-raise text-muted">{asset.kind}</span>
                    <span className="text-[10px] text-faint">
                      {meta.seconds ? secondsLabel(meta.seconds) : fmtClock(asset.createdAt)}
                    </span>
                  </div>
                  {asset.job && (
                    <Link
                      href={`/jobs/${asset.job.id}`}
                      className="line-clamp-2 text-[11px] leading-snug text-muted hover:text-fg"
                    >
                      {asset.job.title || asset.job.topic}
                    </Link>
                  )}
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[10px] text-faint">
                      {fmtDateLong(asset.createdAt)}
                    </span>
                    <a
                      href={asset.url}
                      download
                      className="text-[10px] text-faint hover:text-accent"
                    >
                      download
                    </a>
                  </div>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterLink({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
        active
          ? "border-accent/50 bg-accent/10 text-fg"
          : "border-line bg-raise text-muted hover:bg-raise2 hover:text-fg"
      }`}
    >
      {label}
      <span className="ml-1.5 text-faint">{count}</span>
    </Link>
  );
}
