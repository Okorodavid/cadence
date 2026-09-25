"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { MODE_META, STATUS_META, WEEKDAYS, fmtTime, isSameDay } from "@/lib/ui";
import type { JobStatus, Mode } from "@/pipelines/types";
import { NewJobDialog } from "./new-job-dialog";
import { Avatar } from "./avatar";

export type CalendarJobView = {
  id: string;
  mode: string;
  status: string;
  title: string;
  topic: string;
  hook: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  error: string | null;
  sceneCount: number;
  date: string;
  scheduledAt: string | null;
};

type SpendView = {
  mock: boolean;
  capUsd: number;
  spentUsd: number;
  remainingUsd: number | null;
};

type Props = {
  weekStartIso: string;
  offset: number;
  jobs: CalendarJobView[];
  totals: Record<string, number>;
  spend: SpendView;
  cadences: { mode: string; perWeek: number; enabled: boolean }[];
  character: {
    name: string;
    avatarUrl: string | null;
    lookbook: string[];
    soulId: string | null;
  } | null;
  niche: string;
};

export function CalendarWeek({
  weekStartIso,
  offset,
  jobs,
  totals,
  spend,
  cadences,
  character,
  niche,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, Partial<CalendarJobView>>>({});
  const [newFor, setNewFor] = useState<string | null>(null);

  const weekStart = useMemo(() => new Date(weekStartIso), [weekStartIso]);
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [weekStart],
  );

  const merged = useMemo(
    () => jobs.map((j) => ({ ...j, ...(live[j.id] ?? {}) })),
    [jobs, live],
  );

  const working = merged.some(
    (j) => j.status === "rendering" || j.status === "idea" || j.status === "scripted",
  );

  // Poll while anything is in flight so cards flip to ready on their own.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const data = (await res.json()) as { jobs: CalendarJobView[] };
        const next: Record<string, Partial<CalendarJobView>> = {};
        let changed = false;
        for (const j of data.jobs) {
          const current = merged.find((m) => m.id === j.id);
          if (!current) continue;
          if (
            current.status !== j.status ||
            current.thumbnailUrl !== j.thumbnailUrl ||
            current.title !== j.title
          ) {
            changed = true;
          }
          next[j.id] = {
            status: j.status,
            title: j.title,
            thumbnailUrl: j.thumbnailUrl,
            videoUrl: j.videoUrl,
            error: j.error,
          };
        }
        setLive(next);
        if (changed) router.refresh();
      } catch {
        /* keep polling */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [working, merged, router]);

  async function fill(days: number) {
    setBusy(days === 1 ? "fill1" : "fill");
    try {
      const res = await fetch("/api/fill-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days, run: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fill failed");
      if (data.created === 0) {
        alert(
          days === 1
            ? "No open day in the next stretch — those days already have jobs."
            : "The next 7 days already have jobs for every cadence slot.",
        );
      }
      startTransition(() => router.refresh());
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteJob(job: CalendarJobView) {
    const label = job.title || job.topic || "this job";
    const hasRender = Boolean(job.videoUrl);
    const ok = window.confirm(
      `Remove "${label}" from the calendar?` +
        (hasRender ? "\n\nIts rendered video and files will be deleted too." : "") +
        "\n\nThis can't be undone.",
    );
    if (!ok) return;

    setBusy(job.id);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not remove the job");
      startTransition(() => router.refresh());
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runJob(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/jobs/${id}/run`, { method: "POST" });
      setLive((l) => ({ ...l, [id]: { ...l[id], status: "rendering" } }));
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  const plannedPerWeek = cadences.reduce((a, c) => a + (c.enabled ? c.perWeek : 0), 0);
  const today = new Date();

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 py-6">
        <div className="flex items-center gap-3.5">
          {character && (
            <Link href="/character" title={`${character.name} — the face in every UGC clip`}>
              <Avatar src={character.avatarUrl} name={character.name} size={48} />
            </Link>
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
            <p className="mt-1 text-sm text-muted">
              {character ? (
                <>
                  <span className="text-fg">{character.name}</span> ·{" "}
                  {niche || "no niche set"} · {plannedPerWeek}/week planned
                </>
              ) : (
                <>
                  No character yet —{" "}
                  <Link href="/character" className="text-accent underline">
                    create one
                  </Link>{" "}
                  so the same face shows up in every clip.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SpendMeter spend={spend} />
          <StatusTotals totals={totals} />
          <div className="flex items-center overflow-hidden rounded-lg border border-line">
            <Link
              href={`/calendar?w=${offset - 1}`}
              className="btn btn-sm rounded-none border-0 border-r border-line"
            >
              ←
            </Link>
            <Link
              href="/calendar"
              className="btn btn-sm rounded-none border-0 border-r border-line"
            >
              Today
            </Link>
            <Link href={`/calendar?w=${offset + 1}`} className="btn btn-sm rounded-none border-0">
              →
            </Link>
          </div>
          <button
            onClick={() => fill(1)}
            disabled={!!busy || pending}
            className="btn"
            title="Fill just the next open day — a bounded, low-cost run"
          >
            {busy === "fill1" ? "Filling…" : "Fill 1 day"}
          </button>
          <button
            onClick={() => fill(7)}
            disabled={!!busy || pending}
            className="btn btn-primary"
          >
            {busy === "fill" ? "Filling…" : "Fill next 7 days"}
          </button>
        </div>
      </div>

      <div className="grid-bg grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {days.map((day) => {
          const dayJobs = merged.filter((j) => isSameDay(new Date(j.date), day));
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className={`group/day flex min-h-[260px] flex-col bg-surface p-2.5 ${
                isToday ? "bg-raise/60" : ""
              }`}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`text-[11px] font-semibold uppercase tracking-wider ${
                      isToday ? "text-accent" : "text-faint"
                    }`}
                  >
                    {WEEKDAYS[(day.getDay() + 6) % 7]}
                  </span>
                  <span
                    className={`text-sm font-semibold ${isToday ? "text-accent" : "text-muted"}`}
                  >
                    {day.getDate()}
                  </span>
                </div>
                <button
                  onClick={() => setNewFor(day.toISOString())}
                  className="rounded px-1.5 text-muted opacity-0 transition hover:bg-raise2 hover:text-fg focus:opacity-100 group-hover/day:opacity-100"
                  title="Add a job on this day"
                  aria-label="Add a job on this day"
                >
                  +
                </button>
              </div>

              <div className="flex flex-1 flex-col gap-2">
                {dayJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    busy={busy === job.id}
                    onRun={() => runJob(job.id)}
                    onDelete={() => deleteJob(job)}
                  />
                ))}
                {!dayJobs.length && (
                  <button
                    onClick={() => setNewFor(day.toISOString())}
                    className="flex-1 rounded-lg border border-dashed border-line/70 text-xs text-faint transition hover:border-line hover:text-muted"
                  >
                    empty
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {newFor && (
        <NewJobDialog
          date={newFor}
          onClose={() => setNewFor(null)}
          onCreated={() => {
            setNewFor(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </>
  );
}

function SpendMeter({ spend }: { spend: SpendView }) {
  // MOCK spends nothing — show that plainly so the demo doesn't imply a bill.
  if (spend.mock) {
    return (
      <span
        className="hidden items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11px] lg:inline-flex"
        title="MOCK mode — no Higgsfield credits are spent"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-go" />
        <span className="text-faint">Spend</span>
        <span className="font-medium text-muted">$0 · mock</span>
      </span>
    );
  }

  const capped = spend.capUsd > 0;
  const ratio = capped ? Math.min(spend.spentUsd / spend.capUsd, 1) : 0;
  const tone =
    capped && ratio >= 1
      ? "text-hot"
      : capped && ratio >= 0.8
        ? "text-accent"
        : "text-muted";
  return (
    <span
      className="hidden items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11px] lg:inline-flex"
      title={
        capped
          ? `~$${spend.spentUsd.toFixed(2)} of $${spend.capUsd.toFixed(2)} this week (estimated). Set by SPEND_CAP_USD_PER_WEEK.`
          : "No weekly cap set — SPEND_CAP_USD_PER_WEEK is unset (uncapped)."
      }
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${capped ? (ratio >= 1 ? "bg-hot" : ratio >= 0.8 ? "bg-accent" : "bg-go") : "bg-faint"}`}
      />
      <span className="text-faint">This week</span>
      <span className={`font-medium ${tone}`}>
        ~${spend.spentUsd.toFixed(2)}
        {capped ? ` / $${spend.capUsd.toFixed(0)}` : " · uncapped"}
      </span>
    </span>
  );
}

function StatusTotals({ totals }: { totals: Record<string, number> }) {
  const order: JobStatus[] = ["ready", "review", "rendering", "scripted", "idea", "failed"];
  const shown = order.filter((s) => totals[s]);
  if (!shown.length) return null;
  return (
    <div className="mr-1 hidden items-center gap-2 lg:flex">
      {shown.map((s) => (
        <span key={s} className="flex items-center gap-1.5 text-xs text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[s].dot}`} />
          {totals[s]}
          <span className="text-faint">{STATUS_META[s].label.toLowerCase()}</span>
        </span>
      ))}
    </div>
  );
}

function JobCard({
  job,
  busy,
  onRun,
  onDelete,
}: {
  job: CalendarJobView;
  busy: boolean;
  onRun: () => void;
  onDelete: () => void;
}) {
  const mode = MODE_META[job.mode as Mode];
  const status = STATUS_META[job.status as JobStatus] ?? STATUS_META.idea;
  const inFlight = job.status === "rendering";

  return (
    <div
      className={`group relative overflow-hidden rounded-lg border border-line bg-raise transition hover:border-line/80 hover:bg-raise2 ${
        inFlight ? "animate-working" : ""
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
        disabled={busy}
        title="Remove from calendar"
        aria-label={`Remove "${job.title || job.topic}" from calendar`}
        className="absolute top-1.5 right-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border border-line bg-ink/85 text-[11px] leading-none text-muted opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-hot hover:text-white focus:opacity-100"
      >
        ✕
      </button>
      <Link href={`/jobs/${job.id}`} className="block">
        {job.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={job.thumbnailUrl}
            alt=""
            className="h-24 w-full object-cover opacity-90 transition group-hover:opacity-100"
          />
        ) : (
          <div className="flex h-10 items-center gap-1.5 px-2.5">
            <span className={`h-1.5 w-1.5 rounded-full ${mode?.dot ?? "bg-faint"}`} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
              {mode?.label ?? job.mode}
            </span>
          </div>
        )}

        <div className="px-2.5 pt-2 pb-2.5">
          <p className="line-clamp-2 text-[13px] leading-snug font-medium text-fg">
            {job.title || job.topic || "Untitled"}
          </p>

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className={`chip ${status.className}`}>{status.label}</span>
            <span className="text-[10px] text-faint">
              {job.scheduledAt ? fmtTime(new Date(job.scheduledAt)) : ""}
            </span>
          </div>

          {job.status === "failed" && job.error && (
            <p className="mt-1.5 line-clamp-2 text-[10px] text-hot/80">{job.error}</p>
          )}
        </div>
      </Link>

      {(job.status === "idea" || job.status === "failed") && (
        <div className="border-t border-line px-2 py-1.5">
          <button
            onClick={onRun}
            disabled={busy}
            className="btn btn-ghost btn-sm w-full justify-center"
          >
            {busy ? "Starting…" : job.status === "failed" ? "Retry" : "Generate"}
          </button>
        </div>
      )}
    </div>
  );
}
