"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MODE_META } from "@/lib/ui";
import type { Mode } from "@/pipelines/types";

type Brand = {
  niche: string;
  audience: string;
  tone: string;
  rpmCategory: string;
  hookStyle: string;
  cta: string;
  bannedPhrases: string[];
  colors: string[];
};

const MODES: Mode[] = ["zach_short", "ugc_ad", "faceless_yt"];

export function BrandForm({
  brand,
  cadences,
}: {
  brand: Brand;
  cadences: Record<string, number>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState(brand);
  const [banned, setBanned] = useState(brand.bannedPhrases.join(", "));
  const [rates, setRates] = useState<Record<string, number>>({
    zach_short: cadences.zach_short ?? 7,
    ugc_ad: cadences.ugc_ad ?? 3,
    faceless_yt: cadences.faceless_yt ?? 2,
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const set = (k: keyof Brand) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          bannedPhrases: banned
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          cadences: MODES.map((m) => ({ mode: m, perWeek: rates[m] ?? 0 })),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setNote("Saved. Fill next 7 days on the calendar will use this.");
      startTransition(() => router.refresh());
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const total = MODES.reduce(
    (a, m) => a + (MODE_META[m].comingSoon ? 0 : rates[m] ?? 0),
    0,
  );

  return (
    <div className="py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Brand & cadence</h1>
          <p className="mt-1 text-sm text-muted">
            The writer reads this on every job, and the schedule comes from the rates below.
          </p>
        </div>
        <button onClick={save} disabled={busy} className="btn btn-primary">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {note && (
        <p className="mb-5 rounded-lg border border-line bg-raise px-3 py-2 text-xs text-muted">
          {note}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-4 p-5">
          <h2 className="panel-title">Brand kit</h2>

          <Field
            label="Niche"
            value={form.niche}
            onChange={set("niche")}
            placeholder="how everyday things actually work"
          />
          <Field
            label="Audience"
            value={form.audience}
            onChange={set("audience")}
            placeholder="curious 18–34s who watch shorts before bed"
          />
          <Field
            label="Tone"
            value={form.tone}
            onChange={set("tone")}
            placeholder="calm, direct, no hype"
          />
          <Field
            label="Hook style"
            value={form.hookStyle}
            onChange={set("hookStyle")}
            placeholder="state the surprising fact first, explain second"
          />
          <Field
            label="RPM category"
            value={form.rpmCategory}
            onChange={set("rpmCategory")}
            placeholder="education"
          />
          <Field
            label="CTA"
            value={form.cta}
            onChange={set("cta")}
            placeholder="Follow for one of these a day."
          />

          <div>
            <label className="label" htmlFor="banned">
              Banned phrases
            </label>
            <input
              id="banned"
              className="input"
              value={banned}
              onChange={(e) => setBanned(e.target.value)}
              placeholder="welcome back, guys, mind-blowing"
            />
            <p className="mt-1 text-[11px] text-faint">
              Comma separated. Stripped from every script before it renders.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="panel-title">Cadence</h2>
              <span className="text-[11px] text-faint">{total} pieces / week</span>
            </div>
            <p className="mb-4 text-[11px] leading-relaxed text-faint">
              How many of each per week. Fill next 7 days spreads them evenly across the
              week rather than stacking them on Monday.
            </p>

            <div className="space-y-4">
              {MODES.map((m) => {
                const meta = MODE_META[m];
                const soon = meta.comingSoon;
                return (
                  <div key={m} className={soon ? "opacity-50" : undefined}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium">
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                        {soon && (
                          <span className="rounded bg-cool/15 px-1 py-0.5 text-[8px] font-bold tracking-wide text-cool uppercase">
                            Soon
                          </span>
                        )}
                      </span>
                      <span className="text-[13px] tabular-nums text-muted">
                        {soon ? "—" : rates[m] ?? 0}
                        {!soon && <span className="text-faint">/wk</span>}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={7}
                      disabled={soon}
                      value={rates[m] ?? 0}
                      onChange={(e) =>
                        setRates((r) => ({ ...r, [m]: Number(e.target.value) }))
                      }
                      className="w-full accent-accent disabled:cursor-not-allowed"
                      aria-label={`${meta.label} per week`}
                    />
                    <p className="mt-0.5 text-[10px] text-faint">
                      {soon ? "Coming soon" : meta.blurb}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="panel-title mb-3">How a job runs</h2>
            <ol className="space-y-2 text-[12px] leading-relaxed text-muted">
              {[
                "Topic picked from your niche (or typed in by hand)",
                "Claude writes the script and splits it into beats",
                "Narration is generated first — its length sets each beat's length",
                "Higgsfield Soul renders a still per beat with the style lock applied",
                "Higgsfield Seedance animates each still with a camera move",
                "ffmpeg conforms, stitches, muxes the VO and burns the captions",
                "Thumbnail picked from the highest-contrast frame, then packaged",
              ].map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded bg-raise2 text-[10px] font-bold text-faint">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  );
}
