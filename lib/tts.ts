/**
 * Narration. Three providers, picked automatically:
 *
 *   elevenlabs — if ELEVENLABS_API_KEY is set
 *   sapi       — Windows System.Speech, free and offline (the $0 demo path)
 *   silent     — timed silence sized from the word count, captions carry it
 *
 * Every provider returns a normalized 48kHz mono WAV so the concat + mux step
 * downstream never has to care which one ran.
 */

import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { exec, ffmpeg, probeDuration, silentWav } from "./ffmpeg";
import { ensureDirFor, mediaPath, mediaUrl } from "./storage";
import { normalizeVoiceSettings, type VoiceSettings } from "./voice-presets";

export type TtsProvider = "elevenlabs" | "sapi" | "silent";

export function ttsProvider(): TtsProvider {
  const forced = process.env.TTS_PROVIDER as TtsProvider | undefined;
  if (forced) return forced;
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (process.platform === "win32") return "sapi";
  return "silent";
}

/** ~155 wpm delivery, with a floor so one-word beats still breathe. */
export function estimateSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.6, (words / 155) * 60 + 0.45);
}

export type SpeakResult = { url: string; absPath: string; seconds: number };

/**
 * The narrator's voice. `voiceId` is provider-prefixed
 * ("sapi:Microsoft David Desktop" / "elevenlabs:<id>"); a prefix for another
 * provider is ignored so switching providers never breaks a render.
 */
export type VoiceSpec = {
  voiceId?: string | null;
  settings?: VoiceSettings | null;
};

/** Short stable hash of a voice spec — changes when the voice changes. */
export function voiceSignature(voice?: VoiceSpec | null): string {
  const s = normalizeVoiceSettings(voice?.settings);
  const key = `${voice?.voiceId ?? ""}|${s.speed}|${s.pitch}|${s.stability}|${s.style}`;
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 8);
}

export async function speak(params: {
  text: string;
  rel: string; // storage path, e.g. jobs/<id>/vo/001.wav
  voice?: VoiceSpec | null;
}): Promise<SpeakResult> {
  const { text, rel, voice } = params;
  await ensureDirFor(rel);
  const out = mediaPath(rel);
  const provider = ttsProvider();
  const settings = normalizeVoiceSettings(voice?.settings);
  const voiceId = voice?.voiceId ?? null;

  const raw = `${out}.raw`;
  try {
    if (provider === "elevenlabs" && text.trim()) {
      const id = voiceId?.startsWith("elevenlabs:") ? voiceId.slice("elevenlabs:".length) : null;
      await elevenlabs(text, raw, id, settings);
      await normalize(raw, out, settings);
    } else if (provider === "sapi" && text.trim()) {
      const name = voiceId?.startsWith("sapi:") ? voiceId.slice("sapi:".length) : null;
      await sapi(text, raw, name);
      await normalize(raw, out, settings);
    } else {
      await silentWav(out, estimateSeconds(text) / settings.speed);
    }
  } catch (err) {
    // Never let a voice failure kill a render — fall back to timed silence.
    console.warn(`[tts] ${provider} failed, using silence:`, (err as Error).message);
    await silentWav(out, estimateSeconds(text) / settings.speed);
  } finally {
    await fs.rm(raw, { force: true });
  }

  return { url: mediaUrl(rel), absPath: out, seconds: await probeDuration(out) };
}

/**
 * 48kHz mono, loudness-normalized, short tail so beats don't clip — plus the
 * voice's speed and pitch. Done here in ffmpeg so both work identically for
 * every provider:
 *   pitch: asetrate by 2^(st/12) raises pitch *and* speed; atempo undoes the
 *          speed part, leaving only the pitch shift.
 *   speed: folded into the same atempo.
 */
async function normalize(
  input: string,
  out: string,
  settings: ReturnType<typeof normalizeVoiceSettings>,
): Promise<void> {
  const f = Math.pow(2, settings.pitch / 12);
  const tempo = settings.speed / f;
  const shape =
    Math.abs(settings.pitch) > 0.01 || Math.abs(settings.speed - 1) > 0.005
      ? [
          "aresample=48000",
          `asetrate=${Math.round(48000 * f)}`,
          "aresample=48000",
          `atempo=${tempo.toFixed(4)}`,
        ]
      : [];
  await ffmpeg([
    "-i",
    input,
    "-af",
    [...shape, "loudnorm=I=-16:TP=-1.5:LRA=11", "apad=pad_dur=0.25"].join(","),
    "-ac",
    "1",
    "-ar",
    "48000",
    "-c:a",
    "pcm_s16le",
    out,
  ]);
}

async function elevenlabs(
  text: string,
  out: string,
  voiceId: string | null,
  settings: ReturnType<typeof normalizeVoiceSettings>,
): Promise<void> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  const model = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: settings.stability,
          similarity_boost: 0.8,
          style: settings.style,
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  await fs.writeFile(out, Buffer.from(await res.arrayBuffer()));
}

/**
 * Windows System.Speech. Text and voice name go in as arguments/files, never
 * interpolated into the script, so quoting can't bite. Speed and pitch are
 * applied afterwards in `normalize`, so SAPI speaks at its natural rate.
 */
async function sapi(text: string, out: string, voiceName: string | null): Promise<void> {
  if (process.platform !== "win32") throw new Error("sapi is Windows-only");
  const txtFile = `${out}.txt`;
  await fs.writeFile(txtFile, text, "utf8");

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$preferred = [string]$args[2]
if (-not $preferred) { $preferred = $env:SAPI_VOICE }
if ($preferred) { try { $synth.SelectVoice($preferred) } catch {} }
$synth.SetOutputToWaveFile([string]$args[1])
$synth.Speak([System.IO.File]::ReadAllText([string]$args[0], [System.Text.Encoding]::UTF8))
$synth.Dispose()
`.trim();

  const scriptFile = path.join(path.dirname(out), `tts-${path.basename(out)}.ps1`);
  await fs.writeFile(scriptFile, script, "utf8");
  try {
    await exec("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptFile,
      txtFile,
      out,
      voiceName ?? "",
    ]);
  } finally {
    await fs.rm(scriptFile, { force: true });
    await fs.rm(txtFile, { force: true });
  }
}
