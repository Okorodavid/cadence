"use client";

import { useEffect, useRef, useState } from "react";
import {
  normalizeVoiceSettings,
  type VoiceOption,
  type VoicePreset,
  type VoiceSettings,
} from "@/lib/voice-presets";

type Provider = "sapi" | "elevenlabs" | "silent";

const PROVIDER_LABEL: Record<Provider, string> = {
  sapi: "Windows voices · free",
  elevenlabs: "ElevenLabs",
  silent: "No voice provider",
};

const DEFAULT_SAMPLE =
  "Your leg falls asleep more often than you think. Here's what's really going on.";

/**
 * Build the narrator's voice: pick a voice, start from a voice-type preset,
 * then fine-tune speed and pitch (plus stability/style on ElevenLabs).
 * Preview plays a real sample; Save stores it on the character, and every
 * video it narrates uses it from the next render.
 */
export function VoiceBuilder({
  characterId,
  initialVoiceId,
  initialSettings,
}: {
  characterId: string;
  initialVoiceId: string | null;
  initialSettings: VoiceSettings;
}) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [presets, setPresets] = useState<VoicePreset[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(initialVoiceId);
  const [settings, setSettings] = useState(() => normalizeVoiceSettings(initialSettings));
  const [sample, setSample] = useState(DEFAULT_SAMPLE);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [note, setNote] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    fetch("/api/voices")
      .then((r) => r.json())
      .then((d) => {
        setProvider(d.provider);
        setVoices(d.voices ?? []);
        setPresets(d.presets ?? []);
      })
      .catch(() => setProvider("silent"));
  }, []);

  // Play a fresh preview as soon as it loads.
  useEffect(() => {
    if (previewUrl) void audioRef.current?.play().catch(() => {});
  }, [previewUrl]);

  const isEleven = provider === "elevenlabs";
  const noProvider = provider === "silent";

  function applyPreset(p: VoicePreset) {
    setSettings({ ...p.settings, preset: p.key });
    // If the preset suits a gender and the current voice doesn't match, switch
    // to the first voice that does.
    if (p.prefer) {
      const current = voices.find((v) => v.id === voiceId);
      if (!current || (current.gender && current.gender !== p.prefer)) {
        const match = voices.find((v) => v.gender === p.prefer);
        if (match) setVoiceId(match.id);
      }
    }
    setPreviewUrl(null);
  }

  function tweak(patch: Partial<VoiceSettings>) {
    // Hand-tuning means it's no longer the stock preset.
    setSettings((s) => ({ ...s, ...patch, preset: undefined }));
    setPreviewUrl(null);
  }

  async function preview() {
    setBusy("preview");
    setNote("");
    try {
      const res = await fetch("/api/voices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId, settings, text: sample.slice(0, 300) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      // Cache-bust so re-previewing identical settings still replays.
      setPreviewUrl(`${data.url}?t=${Date.now()}`);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setNote("");
    try {
      const res = await fetch("/api/character", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: characterId, voiceId, voiceSettings: settings }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setNote("Voice saved. New renders use it.");
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const activePreset = presets.find((p) => p.key === settings.preset);

  return (
    <div className="card p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="panel-title">Voice</h2>
        {provider && (
          <span className={`text-[11px] ${noProvider ? "text-hot" : "text-faint"}`}>
            {PROVIDER_LABEL[provider]}
          </span>
        )}
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-faint">
        Narrates every video this character makes. Start from a voice type, then
        tune it and preview.
      </p>

      {noProvider ? (
        <p className="rounded-lg bg-raise px-3 py-2 text-[11px] text-muted">
          No voice provider on this machine — videos render with captions only. Set
          ELEVENLABS_API_KEY to enable voices.
        </p>
      ) : (
        <>
          <span className="label">Voice type</span>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const on = settings.preset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p)}
                  title={p.description}
                  className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                    on
                      ? "border-accent/60 bg-accent/10 text-fg"
                      : "border-line bg-raise text-muted hover:bg-raise2 hover:text-fg"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="-mt-1.5 mb-3 min-h-4 text-[10px] text-faint">
            {activePreset ? activePreset.description : "Custom — tuned by hand"}
          </p>

          <label className="label" htmlFor="voice-select">
            Voice
          </label>
          <select
            id="voice-select"
            value={voiceId ?? ""}
            onChange={(e) => {
              setVoiceId(e.target.value || null);
              setPreviewUrl(null);
            }}
            className="input mb-3"
          >
            <option value="">Default voice</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.gender ? ` · ${v.gender}` : ""}
                {v.accent ? ` · ${v.accent}` : ""}
              </option>
            ))}
          </select>

          <Slider
            label="Speed"
            value={settings.speed}
            min={0.75}
            max={1.35}
            step={0.01}
            display={`${settings.speed.toFixed(2)}×`}
            onChange={(v) => tweak({ speed: v })}
          />
          <Slider
            label="Pitch"
            value={settings.pitch}
            min={-6}
            max={6}
            step={0.5}
            display={`${settings.pitch > 0 ? "+" : ""}${settings.pitch} st`}
            onChange={(v) => tweak({ pitch: v })}
          />
          {isEleven && (
            <>
              <Slider
                label="Stability"
                value={settings.stability}
                min={0}
                max={1}
                step={0.05}
                display={settings.stability.toFixed(2)}
                onChange={(v) => tweak({ stability: v })}
              />
              <Slider
                label="Style"
                value={settings.style}
                min={0}
                max={1}
                step={0.05}
                display={settings.style.toFixed(2)}
                onChange={(v) => tweak({ style: v })}
              />
            </>
          )}

          <label className="label mt-1" htmlFor="voice-sample">
            Sample line
          </label>
          <textarea
            id="voice-sample"
            rows={2}
            maxLength={300}
            value={sample}
            onChange={(e) => {
              setSample(e.target.value);
              setPreviewUrl(null);
            }}
            className="input resize-none text-[12px] leading-relaxed"
          />

          {previewUrl && (
            <audio ref={audioRef} src={previewUrl} controls className="mt-2 h-8 w-full" />
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={preview}
              disabled={!!busy || !sample.trim()}
              className="btn btn-sm"
            >
              {busy === "preview" ? "Speaking…" : "▶ Preview"}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!!busy}
              className="btn btn-sm btn-primary"
            >
              {busy === "save" ? "Saving…" : "Save voice"}
            </button>
          </div>
        </>
      )}

      {note && <p className="mt-2 text-[11px] text-muted">{note}</p>}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  const id = `voice-${label.toLowerCase()}`;
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor={id} className="text-[11px] font-medium text-muted">
          {label}
        </label>
        <span className="text-[11px] tabular-nums text-faint">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </div>
  );
}
