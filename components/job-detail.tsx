"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MODE_META, STATUS_META, fmtClock, fmtDateLong } from "@/lib/ui";
import type { JobStatus, Mode } from "@/pipelines/types";
import { Avatar } from "./avatar";

export type JobView = {
  id: string;
  mode: string;
  status: string;
  title: string;
  topic: string;
  hook: string;
  caption: string;
  description: string;
  tags: string[];
  videoUrl: string | null;
  thumbnailUrl: string | null;
  srtUrl: string | null;
  voiceUrl: string | null;
  error: string | null;
  date: string;
  scheduledAt: string | null;
  captionVariants: string[];
  characterName: string | null;
  characterAvatar: string | null;
};

export type SceneView = {
  id: string;
  order: number;
  seconds: number;
  narration: string;
  visualPrompt: string;
  camera: string;
  onScreenText: string;
  imageUrl: string | null;
  clipUrl: string | null;
  status: string;
  error: string | null;
};

type LogView = { id: string; level: string; message: string; at: string };

export function JobDetail({
  job,
  scenes,
  logs,
}: {
  job: JobView;
  scenes: SceneView[];
  logs: LogView[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [caption, setCaption] = useState(job.caption);
  const [title, setTitle] = useState(job.title);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const mode = MODE_META[job.mode as Mode];
  const status = STATUS_META[job.status as JobStatus] ?? STATUS_META.idea;
  const working = job.status === "rendering" || job.status === "scripted";

  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => startTransition(() => router.refresh()), 4000);
    return () => clearInterval(t);
  }, [working, router]);

  async function post(path: string, body?: unknown, key = path) {
    setBusy(key);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok && res.status !== 202) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, caption }),
      });
      setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  const totalSeconds = scenes.reduce((a, s) => a + s.seconds, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* ── left: script + scenes ─────────────────────────────────────── */}
      <div className="min-w-0">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
                <span className={`h-1.5 w-1.5 rounded-full ${mode?.dot ?? "bg-faint"}`} />
                {mode?.label ?? job.mode}
              </span>
              <span className={`chip ${status.className}`}>{status.label}</span>
              {job.characterName && (
                <span className="flex items-center gap-1.5 text-[11px] text-faint">
                  <Avatar src={job.characterAvatar} name={job.characterName} size={18} />
                  {job.characterName}
                </span>
              )}
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={save}
              placeholder={job.topic || "Untitled"}
              className="w-full max-w-2xl bg-transparent text-2xl font-semibold tracking-tight text-fg outline-none placeholder:text-faint focus:text-fg"
            />
            <p className="mt-1 text-xs text-muted">
              {fmtDateLong(new Date(job.date))} · {scenes.length} beats ·{" "}
              {totalSeconds.toFixed(0)}s · {job.topic}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => post(`/api/jobs/${job.id}/run`, { rescript: true }, "rescript")}
              disabled={!!busy}
              className="btn btn-sm"
            >
              {busy === "rescript" ? "…" : "Rewrite script"}
            </button>
            <button
              onClick={() => post(`/api/jobs/${job.id}/run`, {}, "render")}
              disabled={!!busy}
              className="btn btn-sm"
            >
              {busy === "render" ? "…" : scenes.length ? "Re-render" : "Generate"}
            </button>
            {job.videoUrl && job.status === "review" && (
              <button
                onClick={() => post(`/api/jobs/${job.id}/approve`, { action: "approve" }, "approve")}
                disabled={!!busy}
                className="btn btn-sm btn-primary"
              >
                {busy === "approve" ? "…" : "Approve"}
              </button>
            )}
            {job.status === "ready" && (
              <button
                onClick={() =>
                  post(
                    `/api/jobs/${job.id}/approve`,
                    { action: "schedule", scheduledAt: job.scheduledAt },
                    "schedule",
                  )
                }
                disabled={!!busy}
                className="btn btn-sm"
                title="Mark this slot as booked once you have uploaded it"
              >
                {busy === "schedule" ? "…" : "Mark scheduled"}
              </button>
            )}
            {job.videoUrl && (
              <a href={`/api/jobs/${job.id}/export`} className="btn btn-sm">
                Export pack
              </a>
            )}
            <button
              onClick={async () => {
                const ok = window.confirm(
                  `Delete "${job.title || job.topic}"?` +
                    (job.videoUrl ? "\n\nIts rendered video and files will be deleted too." : "") +
                    "\n\nThis can't be undone.",
                );
                if (!ok) return;
                setBusy("delete");
                try {
                  const res = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(data.error ?? "Could not delete the job");
                  router.push("/calendar");
                } catch (err) {
                  alert((err as Error).message);
                  setBusy(null);
                }
              }}
              disabled={!!busy}
              className="btn btn-sm btn-danger"
            >
              {busy === "delete" ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>

        {job.error && (
          <div className="mb-5 rounded-lg border border-hot/30 bg-hot/10 px-3 py-2.5 text-xs text-hot">
            {job.error}
          </div>
        )}

        {!scenes.length ? (
          <div className="card grid place-items-center p-12 text-center">
            <p className="text-sm text-muted">
              No script yet. Hit <span className="text-fg">Generate</span> and the writer will
              break this topic into beats.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="panel-title">Scene timeline</h2>
              <span className="text-[11px] text-faint">
                {scenes.filter((s) => s.clipUrl).length}/{scenes.length} shot
              </span>
            </div>
            {scenes.map((scene) => (
              <SceneRow
                key={scene.id}
                jobId={job.id}
                scene={scene}
                busy={busy === scene.id}
                onRegenerate={() =>
                  post(`/api/jobs/${job.id}/scenes/${scene.id}`, undefined, scene.id)
                }
              />
            ))}
          </div>
        )}

        {logs.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer text-[11px] font-semibold tracking-wider text-faint uppercase hover:text-muted">
              Run log ({logs.length})
            </summary>
            <div className="mt-2 space-y-1 font-mono text-[11px]">
              {logs.map((l) => (
                <div key={l.id} className="flex gap-2">
                  <span className="text-faint">
                    {fmtClock(new Date(l.at))}
                  </span>
                  <span className={l.level === "error" ? "text-hot" : "text-muted"}>
                    {l.message}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* ── right: preview + packaging ─────────────────────────────────── */}
      <aside className="space-y-4">
        <div className="card overflow-hidden">
          {job.videoUrl ? (
            <video
              key={job.videoUrl}
              src={job.videoUrl}
              poster={job.thumbnailUrl ?? undefined}
              controls
              playsInline
              className="aspect-[9/16] w-full bg-black"
            />
          ) : (
            <div className="grid aspect-[9/16] w-full place-items-center bg-raise text-center">
              <div className="px-6">
                <p className="text-sm text-muted">
                  {working ? "Rendering…" : "No video yet"}
                </p>
                {working && (
                  <p className="mt-1 text-[11px] text-faint">
                    Beats are generated two at a time.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="panel-title mb-3">Packaging</h3>

          <label className="label" htmlFor="hook">
            Hook
          </label>
          <p id="hook" className="mb-3 text-[13px] leading-snug text-fg">
            {job.hook || "—"}
          </p>

          <label className="label" htmlFor="caption">
            Caption
          </label>
          <textarea
            id="caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={save}
            rows={3}
            className="input resize-none text-[13px]"
          />

          {job.captionVariants.length > 1 && (
            <div className="mt-2 space-y-1">
              <span className="label mb-1">Variants</span>
              {job.captionVariants.map((c, i) => (
                <button
                  key={i}
                  onClick={() => setCaption(c)}
                  className="block w-full rounded-md bg-raise px-2 py-1.5 text-left text-[11px] text-muted hover:bg-raise2 hover:text-fg"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {job.description && (
            <>
              <span className="label mt-3">Description</span>
              <p className="text-[12px] leading-relaxed text-muted">{job.description}</p>
            </>
          )}

          {job.tags.length > 0 && (
            <>
              <span className="label mt-3">Tags</span>
              <div className="flex flex-wrap gap-1">
                {job.tags.map((t) => (
                  <span key={t} className="chip bg-raise text-muted">
                    {t}
                  </span>
                ))}
              </div>
            </>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <span className="text-[11px] text-faint">
              {savedAt ? `Saved ${savedAt}` : "Edits save on blur"}
            </span>
            <button onClick={save} disabled={busy === "save"} className="btn btn-sm">
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {(job.srtUrl || job.thumbnailUrl || job.voiceUrl) && (
          <div className="card p-4">
            <h3 className="panel-title mb-3">Assets</h3>
            <div className="space-y-1.5 text-[12px]">
              {job.videoUrl && <AssetLink href={job.videoUrl} label="final.mp4" />}
              {job.srtUrl && <AssetLink href={job.srtUrl} label="captions.srt" />}
              {job.thumbnailUrl && <AssetLink href={job.thumbnailUrl} label="thumbnail.jpg" />}
              {job.voiceUrl && <AssetLink href={job.voiceUrl} label="voiceover.wav" />}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function AssetLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="flex items-center justify-between rounded-md px-2 py-1.5 text-muted hover:bg-raise hover:text-fg"
    >
      <span className="font-mono">{label}</span>
      <span className="text-faint">download</span>
    </a>
  );
}

function SceneRow({
  jobId,
  scene,
  busy,
  onRegenerate,
}: {
  jobId: string;
  scene: SceneView;
  busy: boolean;
  onRegenerate: () => void;
}) {
  const [narration, setNarration] = useState(scene.narration);
  const [visualPrompt, setVisualPrompt] = useState(scene.visualPrompt);
  const [open, setOpen] = useState(false);

  async function saveScene() {
    if (narration === scene.narration && visualPrompt === scene.visualPrompt) return;
    await fetch(`/api/jobs/${jobId}/scenes/${scene.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ narration, visualPrompt }),
    });
  }

  const dotClass =
    scene.status === "done"
      ? "bg-go"
      : scene.status === "failed"
        ? "bg-hot"
        : scene.status === "pending"
          ? "bg-faint"
          : "bg-accent animate-working";

  return (
    <div className="card overflow-hidden">
      <div className="flex gap-3 p-2.5">
        <div className="relative w-20 shrink-0 overflow-hidden rounded-md bg-raise">
          {scene.clipUrl ? (
            <video
              src={scene.clipUrl}
              muted
              loop
              playsInline
              onMouseEnter={(e) => void e.currentTarget.play()}
              onMouseLeave={(e) => {
                e.currentTarget.pause();
                e.currentTarget.currentTime = 0;
              }}
              className="aspect-[9/16] w-full object-cover"
            />
          ) : scene.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={scene.imageUrl} alt="" className="aspect-[9/16] w-full object-cover" />
          ) : (
            <div className="grid aspect-[9/16] w-full place-items-center text-[10px] text-faint">
              —
            </div>
          )}
          <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[9px] font-bold text-white">
            {scene.order}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
            <span className="text-[10px] tracking-wider text-faint uppercase">
              {scene.camera} · {scene.seconds.toFixed(1)}s
            </span>
            {scene.onScreenText && (
              <span className="chip bg-raise text-muted">{scene.onScreenText}</span>
            )}
          </div>

          <textarea
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            onBlur={saveScene}
            rows={2}
            className="w-full resize-none bg-transparent text-[13px] leading-snug text-fg outline-none"
          />

          {open && (
            <div className="mt-2">
              <span className="label">Visual prompt</span>
              <textarea
                value={visualPrompt}
                onChange={(e) => setVisualPrompt(e.target.value)}
                onBlur={saveScene}
                rows={3}
                className="input resize-none font-mono text-[11px] leading-relaxed"
              />
            </div>
          )}

          {scene.error && (
            <p className="mt-1 text-[10px] text-hot/80">{scene.error}</p>
          )}

          <div className="mt-1.5 flex items-center gap-1">
            <button onClick={() => setOpen((o) => !o)} className="btn btn-ghost btn-sm">
              {open ? "Hide prompt" : "Prompt"}
            </button>
            <button onClick={onRegenerate} disabled={busy} className="btn btn-ghost btn-sm">
              {busy ? "Regenerating…" : "Regenerate scene"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
