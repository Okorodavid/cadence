/**
 * Lists the voices the current TTS provider can speak with. Server-only.
 *
 *   sapi        — voices installed in Windows (System.Speech)
 *   elevenlabs  — voices on the ElevenLabs account (needs ELEVENLABS_API_KEY)
 *   silent      — none
 */

import { exec } from "./ffmpeg";
import { ttsProvider, type TtsProvider } from "./tts";
import type { VoiceOption } from "./voice-presets";

let sapiCache: VoiceOption[] | null = null;

async function listSapiVoices(): Promise<VoiceOption[]> {
  if (sapiCache) return sapiCache;
  if (process.platform !== "win32") return [];
  const script =
    "Add-Type -AssemblyName System.Speech; " +
    "(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | " +
    "Where-Object { $_.Enabled } | ForEach-Object { " +
    "$_.VoiceInfo.Name + '|' + $_.VoiceInfo.Gender + '|' + $_.VoiceInfo.Culture }";
  try {
    const out = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    sapiCache = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, gender, culture] = line.split("|");
        const g = gender?.toLowerCase();
        return {
          id: `sapi:${name}`,
          name: name.replace(/^Microsoft\s+/, "").replace(/\s+Desktop$/, ""),
          gender: g === "male" || g === "female" ? g : undefined,
          accent: culture,
        } satisfies VoiceOption;
      });
    return sapiCache;
  } catch {
    return [];
  }
}

async function listElevenLabsVoices(): Promise<VoiceOption[]> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return [];
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": key },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    voices?: { voice_id: string; name: string; labels?: Record<string, string> }[];
  };
  return (data.voices ?? []).map((v) => {
    const g = v.labels?.gender?.toLowerCase();
    return {
      id: `elevenlabs:${v.voice_id}`,
      name: v.name,
      gender: g === "male" || g === "female" ? g : undefined,
      accent: v.labels?.accent,
    };
  });
}

export async function listVoices(): Promise<{
  provider: TtsProvider;
  voices: VoiceOption[];
}> {
  const provider = ttsProvider();
  if (provider === "sapi") return { provider, voices: await listSapiVoices() };
  if (provider === "elevenlabs") return { provider, voices: await listElevenLabsVoices() };
  return { provider, voices: [] };
}
