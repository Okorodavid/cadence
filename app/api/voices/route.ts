import { NextResponse } from "next/server";
import { listVoices } from "@/lib/voices";
import { VOICE_PRESETS } from "@/lib/voice-presets";

export const runtime = "nodejs";

/** Voices the current TTS provider can use, plus the voice-type presets. */
export async function GET() {
  const { provider, voices } = await listVoices();
  return NextResponse.json({ provider, voices, presets: VOICE_PRESETS });
}
