import { NextResponse } from "next/server";
import { z } from "zod";
import { exists, mediaUrl } from "@/lib/storage";
import { speak, voiceSignature } from "@/lib/tts";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

const Schema = z.object({
  voiceId: z.string().nullable().optional(),
  settings: z
    .object({
      preset: z.string().optional(),
      speed: z.number().optional(),
      pitch: z.number().optional(),
      stability: z.number().optional(),
      style: z.number().optional(),
    })
    .optional(),
  text: z.string().min(1).max(300),
});

/**
 * Speak a short sample in the given voice so it can be heard before saving.
 * Cached by voice + text, so replaying the same preview is instant.
 * Windows voices are free; ElevenLabs previews use ElevenLabs characters.
 */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { voiceId, settings, text } = parsed.data;
  const voice = { voiceId: voiceId ?? null, settings: settings ?? {} };

  const textHash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 8);
  const rel = `voice-previews/${voiceSignature(voice)}-${textHash}.wav`;

  if (!(await exists(rel))) {
    await speak({ text, rel, voice });
  }
  return NextResponse.json({ url: mediaUrl(rel) });
}
