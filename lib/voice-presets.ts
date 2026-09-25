/**
 * Voice "types" — a preset is a starting point for building the narrator's
 * voice: a delivery speed, a pitch shift, and (ElevenLabs only) stability and
 * style. Client-safe: no node imports.
 *
 * Speed and pitch are applied after synthesis with ffmpeg, so they work the
 * same for every provider (Windows voices and ElevenLabs alike).
 */

export type VoiceSettings = {
  preset?: string;
  /** Delivery speed multiplier, 0.75–1.35 (1 = natural). */
  speed?: number;
  /** Pitch shift in semitones, -6..+6 (0 = natural). */
  pitch?: number;
  /** ElevenLabs only: 0–1. Higher = steadier, lower = more expressive. */
  stability?: number;
  /** ElevenLabs only: 0–1. Style exaggeration. */
  style?: number;
};

export type VoicePreset = {
  key: string;
  label: string;
  description: string;
  /** Voice gender this preset suits best, used to pick a default voice. */
  prefer?: "male" | "female";
  settings: Required<Omit<VoiceSettings, "preset">>;
};

export const VOICE_PRESETS: VoicePreset[] = [
  {
    key: "calm-narrator",
    label: "Calm narrator",
    description: "Even, unhurried — the 3D explainer default",
    settings: { speed: 0.96, pitch: -1, stability: 0.6, style: 0.2 },
  },
  {
    key: "deep-documentary",
    label: "Deep documentary",
    description: "Lower and slower, serious weight",
    prefer: "male",
    settings: { speed: 0.9, pitch: -4, stability: 0.7, style: 0.15 },
  },
  {
    key: "energetic-creator",
    label: "Energetic creator",
    description: "Quick and bright, for UGC hooks",
    settings: { speed: 1.14, pitch: 2, stability: 0.35, style: 0.6 },
  },
  {
    key: "warm-friendly",
    label: "Warm & friendly",
    description: "Relaxed, conversational, a smile in it",
    prefer: "female",
    settings: { speed: 1.0, pitch: 1, stability: 0.5, style: 0.4 },
  },
  {
    key: "news-anchor",
    label: "News anchor",
    description: "Crisp, steady, authoritative",
    settings: { speed: 1.05, pitch: 0, stability: 0.8, style: 0.1 },
  },
];

export const DEFAULT_VOICE_SETTINGS: Required<Omit<VoiceSettings, "preset">> = {
  speed: 1,
  pitch: 0,
  stability: 0.5,
  style: 0.3,
};

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : fallback;
};

/** Fill defaults and clamp every field into its safe range. */
export function normalizeVoiceSettings(
  raw: VoiceSettings | null | undefined,
): Required<Omit<VoiceSettings, "preset">> & { preset?: string } {
  const d = DEFAULT_VOICE_SETTINGS;
  return {
    preset: raw?.preset,
    speed: clamp(raw?.speed, 0.75, 1.35, d.speed),
    pitch: clamp(raw?.pitch, -6, 6, d.pitch),
    stability: clamp(raw?.stability, 0, 1, d.stability),
    style: clamp(raw?.style, 0, 1, d.style),
  };
}

export type VoiceOption = {
  id: string; // "sapi:<name>" | "elevenlabs:<id>"
  name: string;
  gender?: "male" | "female";
  accent?: string;
};
