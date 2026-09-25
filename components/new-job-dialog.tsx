"use client";

import { useEffect, useState } from "react";
import { MODE_META, fmtDateLong } from "@/lib/ui";
import type { Mode } from "@/pipelines/types";

const MODES: Mode[] = ["zach_short", "ugc_ad", "faceless_yt"];

export function NewJobDialog({
  date,
  onClose,
  onCreated,
}: {
  date: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<Mode>("zach_short");
  const [topic, setTopic] = useState("");
  const [productName, setProductName] = useState("");
  const [offer, setOffer] = useState("");
  const [runNow, setRunNow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          topic,
          date,
          run: runNow,
          inputs:
            mode === "ugc_ad"
              ? { productName: productName || topic, offer }
              : mode === "faceless_yt"
                ? { length: "short" }
                : {},
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the job");
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const day = fmtDateLong(new Date(date));

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-lg p-5"
      >
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">New job</h2>
          <span className="text-xs text-muted">{day}</span>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          {MODES.map((m) => {
            const meta = MODE_META[m];
            const active = mode === m;
            const soon = meta.comingSoon;
            return (
              <button
                key={m}
                type="button"
                disabled={soon}
                onClick={() => setMode(m)}
                title={soon ? "Coming soon" : undefined}
                className={`relative rounded-lg border p-2.5 text-left transition ${
                  soon
                    ? "cursor-not-allowed border-line bg-raise opacity-50"
                    : active
                      ? "border-accent/60 bg-accent/10"
                      : "border-line bg-raise hover:bg-raise2"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                  <span className="text-xs font-semibold">{meta.label}</span>
                </span>
                <span className="mt-1 block text-[10px] leading-snug text-faint">
                  {soon ? "Coming soon" : meta.blurb}
                </span>
                {soon && (
                  <span className="absolute top-1.5 right-1.5 rounded bg-cool/15 px-1 py-0.5 text-[8px] font-bold tracking-wide text-cool uppercase">
                    Soon
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <label className="label" htmlFor="topic">
          {mode === "ugc_ad" ? "Angle / what the ad is about" : "Topic"}
        </label>
        <input
          id="topic"
          className="input"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={
            mode === "zach_short"
              ? "why your leg falls asleep"
              : mode === "faceless_yt"
                ? "the shipping container that changed global trade"
                : "people think it takes all weekend"
          }
          required
          autoFocus
        />

        {mode === "ugc_ad" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="product">
                Product
              </label>
              <input
                id="product"
                className="input"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="standing desk converter"
              />
            </div>
            <div>
              <label className="label" htmlFor="offer">
                Offer
              </label>
              <input
                id="offer"
                className="input"
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                placeholder="20% off with code CADENCE"
              />
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-hot/10 px-3 py-2 text-xs text-hot">{error}</p>
        )}

        <div className="mt-5 flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={runNow}
              onChange={(e) => setRunNow(e.target.checked)}
              className="accent-accent"
            />
            Start generating now
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? "Creating…" : "Add to calendar"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
