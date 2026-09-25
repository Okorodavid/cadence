/**
 * Influencer UGC / ads. Same face across every clip.
 *
 * Input: a product URL or one product photo, plus a one-sentence offer.
 * Output: 3 vertical 9:16 clips, 8-15s each, with the character's locked face.
 *
 * The face lock is the look book: those stills go in as Seedance references on
 * every single clip, so clip 1 and clip 3 are the same person.
 */

import { generateJson } from "@/lib/llm";
import { brandBlock, cameraFor, stripBannedOpeners, type BrandContext } from "@/lib/prompts";
import { z } from "zod";
import { BeatSchema, ScriptResultSchema, type ScriptResult } from "./types";

export const UgcInputSchema = z.object({
  productUrl: z.string().default(""),
  productImageUrl: z.string().default(""),
  productName: z.string().default(""),
  offer: z.string().default(""),
});

export type UgcInput = z.infer<typeof UgcInputSchema>;

const UgcScriptSchema = ScriptResultSchema.extend({
  captions: z.array(z.string()).default([]),
  beats: z.array(BeatSchema).min(3).max(3),
});

const SYSTEM = `You write short-form UGC ad scripts for a single creator talking to camera.

Format: 3 clips. Each clip is one continuous 8-15 second take, shot vertically on a phone.
  Clip 1 — hook. The creator says the problem out loud in the first 2 seconds. Product not visible yet.
  Clip 2 — the product in hand. Show it, use it, one specific benefit. Not a feature list.
  Clip 3 — the offer and the CTA. Direct, no hard sell voice.

Voice: how a real person talks. Contractions, one aside, no ad-copy cadence.
Never say "introducing", "game changer", "revolutionary", "look no further", "elevate your".
No claims about results, health, or income that a real brand could not make.

visualPrompt describes ONE shot of the SAME single person: framing, what their hands do,
the room, the light. Always "one person only". Never describe their face — the face comes
from reference images. No style words; the renderer appends a fixed style lock.`;

export async function writeUgcScript(params: {
  input: UgcInput;
  brand: BrandContext;
  characterName: string;
}): Promise<{ script: ScriptResult; captionVariants: string[]; source: "llm" | "fallback" }> {
  const { input, brand, characterName } = params;
  const product = input.productName || input.productUrl || "the product";

  const prompt = `Product: ${product}
${input.productUrl ? `URL: ${input.productUrl}` : ""}
Offer: ${input.offer || "no specific offer — lead with the benefit"}
Creator: ${characterName}

${brandBlock(brand)}

Write the 3 clips.

JSON:
{
  "title": "internal name for this ad set",
  "hook": "the first spoken line of clip 1",
  "caption": "the best caption",
  "captions": ["3 caption variants, each ending in the CTA"],
  "description": "one line on the angle this ad takes",
  "tags": ["6 lowercase tags"],
  "beats": [
    { "seconds": 10, "narration": "what the creator says", "visualPrompt": "one person only, ...", "camera": "handheld drift left", "onScreenText": "3 WORDS" }
  ]
}`;

  const { value, source } = await generateJson({
    system: SYSTEM,
    prompt,
    schema: UgcScriptSchema,
    fallback: () => fallbackScript(product, input.offer, brand),
    maxTokens: 2500,
  });

  const banned = brand.bannedPhrases ?? [];
  const script: ScriptResult = {
    ...value,
    beats: value.beats.map((b, i) => ({
      ...b,
      narration: stripBannedOpeners(b.narration, banned),
      camera: b.camera?.trim() || cameraFor(i),
      onScreenText: (b.onScreenText || "").toUpperCase().slice(0, 24),
      seconds: Math.min(Math.max(b.seconds, 8), 15),
    })),
  };

  const captionVariants = (value.captions.length ? value.captions : [value.caption])
    .filter(Boolean)
    .slice(0, 3);

  return { script, captionVariants, source };
}

function fallbackScript(
  product: string,
  offer: string,
  brand: BrandContext,
): z.infer<typeof UgcScriptSchema> {
  const cta = brand.cta || "Link in bio.";
  return {
    title: `${product} — UGC set`,
    hook: `I kept putting this off because I thought it would take all weekend.`,
    caption: `Took me four minutes. ${cta}`,
    captions: [
      `Took me four minutes. ${cta}`,
      `I was wrong about ${product}. ${cta}`,
      `This is the part nobody tells you about ${product}. ${cta}`,
    ],
    description: `Problem-first UGC angle for ${product}.`,
    tags: ["ugc", "ad", "review", "shortform", "creator", "product"],
    beats: [
      {
        seconds: 10,
        narration: `I kept putting this off because I thought it would take all weekend. It took me four minutes.`,
        visualPrompt: `One person only, medium close up, sitting on the edge of a bed in a sunlit bedroom, talking directly to a phone held at arm's length, hands empty and gesturing`,
        camera: "handheld drift left",
        onScreenText: "FOUR MINUTES",
      },
      {
        seconds: 12,
        narration: `This is it. You set it once, and it just keeps doing the thing without you.`,
        visualPrompt: `One person only, holding ${product} up into frame at chest height near a bright window, turning it slowly, product clearly visible and in focus`,
        camera: "slow push in",
        onScreenText: "SET IT ONCE",
      },
      {
        seconds: 10,
        narration: `${offer || "It is cheaper than the one I almost bought."} ${cta}`,
        visualPrompt: `One person only, standing in a kitchen, ${product} resting on the counter beside them, relaxed posture, speaking to camera`,
        camera: "crane down to eye level",
        onScreenText: "LINK BELOW",
      },
    ],
  };
}
