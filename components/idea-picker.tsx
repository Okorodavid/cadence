"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MODE_META } from "@/lib/ui";
import type { Mode } from "@/pipelines/types";

type Idea = { topic: string; title: string; hook: string; why: string };

const MODES: Mode[] = ["zach_short", "faceless_yt", "ugc_ad"];

export function IdeaPicker({ defaultNiche }: { defaultNiche: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("zach_short");
  const [niche, setNiche] = useState(defaultNiche);
  const [competitors, setCompetitors] = useState("");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [spacing, setSpacing] = useState(1);
  const [runNow, setRunNow] = useState(false);
  const [busy, setBusy] = useState<"ideas" | "schedule" | null>(null);
  const [note, setNote] = useState("");
  const [source, setSource] = useState<string>("");

  async function generate() {
    setBusy("ideas");
    setNote("");
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          niche,
          competitorTitles: competitors
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          count: 10,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not generate ideas");
      setIdeas(data.ideas);
      setSource(data.source);
      setPicked(new Set(data.ideas.map((_: Idea, i: number) => i)));
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function schedule() {
    setBusy("schedule");
    setNote("");
    try {
      const chosen = [...picked].sort((a, b) => a - b).map((i) => ideas[i]);
      const res = await fetch("/api/ideas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          ideas: chosen.map((i) => ({ topic: i.topic, title: i.title })),
          spacingDays: spacing,
          run: runNow,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not schedule");
      setNote(
        `${data.created} job${data.created === 1 ? "" : "s"} added to the calendar.` +
          (data.rejected?.length ? ` Skipped ${data.rejected.length}.` : ""),
      );
      setIdeas([]);
      setPicked(new Set());
      router.refresh();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function toggle(i: number) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ideas</h1>
        <p className="mt-1 text-sm text-muted">
          Batch a week of topics in one pass. Paste titles that already work in your
          niche — the writer reads the pattern behind them rather than copying them.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="card h-fit p-5">
          <span className="label">Mode</span>
          <div className="mb-4 grid grid-cols-3 gap-1.5">
            {MODES.map((m) => {
              const soon = MODE_META[m].comingSoon;
              return (
                <button
                  key={m}
                  disabled={soon}
                  onClick={() => setMode(m)}
                  title={soon ? "Coming soon" : undefined}
                  className={`rounded-lg border px-2 py-2 text-[11px] font-semibold transition ${
                    soon
                      ? "cursor-not-allowed border-line bg-raise text-faint opacity-50"
                      : mode === m
                        ? "border-accent/60 bg-accent/10 text-fg"
                        : "border-line bg-raise text-muted hover:bg-raise2"
                  }`}
                >
                  {MODE_META[m].short}
                  {soon && <span className="ml-1 text-[8px] text-cool">soon</span>}
                </button>
              );
            })}
          </div>

          <label className="label" htmlFor="niche">
            Niche
          </label>
          <input
            id="niche"
            className="input"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="how everyday things actually work"
          />

          <label className="label mt-4" htmlFor="competitors">
            Competitor titles
          </label>
          <textarea
            id="competitors"
            rows={5}
            className="input resize-none text-[12px] leading-relaxed"
            value={competitors}
            onChange={(e) => setCompetitors(e.target.value)}
            placeholder={"One per line:\nThe container that broke global trade\nWhy supermarkets all look the same"}
          />
          <p className="mt-1 text-[11px] text-faint">
            Optional. {mode === "zach_short" ? "Ignored for 3D shorts — topics come from the niche." : "Three is plenty."}
          </p>

          <button
            onClick={generate}
            disabled={busy !== null}
            className="btn btn-primary mt-4 w-full"
          >
            {busy === "ideas" ? "Thinking…" : "Generate 10 ideas"}
          </button>

          {note && (
            <p className="mt-3 rounded-lg border border-line bg-raise px-3 py-2 text-xs text-muted">
              {note}
            </p>
          )}
        </div>

        <div>
          {!ideas.length ? (
            <div className="card grid min-h-[340px] place-items-center p-10 text-center">
              <p className="max-w-sm text-sm text-muted">
                Nothing yet. Generate a batch, uncheck the weak ones, then drop the rest
                onto the calendar one per day.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] tracking-wider text-faint uppercase">
                  {picked.size}/{ideas.length} selected
                  {source === "fallback" && " · template writer (no ANTHROPIC_API_KEY)"}
                </span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    one every
                    <select
                      value={spacing}
                      onChange={(e) => setSpacing(Number(e.target.value))}
                      className="rounded-md border border-line bg-raise px-1.5 py-1 text-xs"
                    >
                      {[1, 2, 3, 7].map((n) => (
                        <option key={n} value={n}>
                          {n === 1 ? "day" : `${n} days`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={runNow}
                      onChange={(e) => setRunNow(e.target.checked)}
                      className="accent-accent"
                    />
                    start rendering
                  </label>
                  <button
                    onClick={schedule}
                    disabled={!picked.size || busy !== null}
                    className="btn btn-sm btn-primary"
                  >
                    {busy === "schedule" ? "Adding…" : `Add ${picked.size} to calendar`}
                  </button>
                </div>
              </div>

              <ul className="space-y-2">
                {ideas.map((idea, i) => {
                  const on = picked.has(i);
                  return (
                    <li key={i}>
                      <button
                        onClick={() => toggle(i)}
                        className={`flex w-full gap-3 rounded-xl border p-3 text-left transition ${
                          on
                            ? "border-accent/40 bg-accent/5"
                            : "border-line bg-surface opacity-60 hover:opacity-100"
                        }`}
                      >
                        <span
                          className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${
                            on
                              ? "border-accent bg-accent text-black"
                              : "border-line text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-fg">
                            {idea.title || idea.topic}
                          </span>
                          {idea.hook && (
                            <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                              {idea.hook}
                            </span>
                          )}
                          {idea.why && (
                            <span className="mt-1 block text-[10px] tracking-wider text-faint uppercase">
                              {idea.why}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
