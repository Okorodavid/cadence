/**
 * Zach D Films-style short: 40–60s, 9:16, one idea, hard cut ending.
 *
 * The format — not the branding, not his episodes:
 *   1 hook visual + premise     5 consequence
 *   2 wrong mental model        6 "so actually..." reveal
 *   3 cutaway mechanism         7 payoff visual
 *   4 escalate detail           8 button line
 */

import { z } from "zod";
import { generateJson } from "@/lib/llm";
import {
  ZACH_STYLE_LOCK,
  brandBlock,
  cameraFor,
  stripBannedOpeners,
  type BrandContext,
} from "@/lib/prompts";
import { ScriptResultSchema, type ScriptResult } from "./types";

const BEAT_PLAN = [
  "Hook visual plus a one-line premise. Must land in under 2 seconds and show something moving, surprising, or slightly gross.",
  "The simple wrong mental model most people hold.",
  "Cutaway to the actual mechanism. Go inside, under, or behind the thing.",
  "Escalate one specific detail — a number, a scale, a speed.",
  "The consequence if it did not work this way.",
  "The 'so actually...' reveal that flips beat 2.",
  "Payoff visual — the whole system working, seen wide.",
  "Button line. One sentence, then cut to black. No outro, no sign-off.",
];

const SYSTEM = `You write 45-60 second vertical 3D explainer shorts.

Voice: one narrator, calm and direct, present tense, short declarative sentences.
Never write "welcome back", "hey guys", "in this video", "let's dive in", or "have you ever wondered".
The first sentence is a pattern interrupt — a claim or an image, never a question about the viewer's day.
One idea per short. No tangents. The last line is a hard button, then the video cuts to black.

Narration rules:
- 10-22 spoken words per beat.
- Plain words. No adjective stacking. No "fascinating", "incredible", "mind-blowing".
- Numbers are concrete and real.

visualPrompt rules:
- Describe ONE shot: subject, action, environment, lens feel.
- Physical and filmable. No abstract concepts, no text in frame, no real people.
- Do NOT include style words — the renderer appends a fixed style lock.

onScreenText: 2-4 words, uppercase, the punch of that beat.`;

export async function writeZachScript(params: {
  topic: string;
  brand: BrandContext;
}): Promise<{ script: ScriptResult; source: "llm" | "fallback" }> {
  const { topic, brand } = params;

  const prompt = `Topic: ${topic}

${brandBlock(brand)}

Write exactly 8 beats following this plan:
${BEAT_PLAN.map((b, i) => `${i + 1}. ${b}`).join("\n")}

Total narration must read aloud in 45-60 seconds (roughly 115-150 words across all beats).
Beat 1 is 3-4 seconds. Beat 8 is 3-5 seconds. The rest are 5-8 seconds.

Return JSON:
{
  "title": "YouTube Shorts title, under 60 chars, no clickbait punctuation",
  "hook": "beat 1 narration, repeated",
  "caption": "one-line social caption with 3 hashtags",
  "description": "2 sentence description",
  "tags": ["8 lowercase tags"],
  "beats": [
    { "seconds": 4, "narration": "...", "visualPrompt": "...", "camera": "slow dolly in", "onScreenText": "TWO WORDS" }
  ]
}`;

  const { value, source } = await generateJson({
    system: SYSTEM,
    prompt,
    schema: ScriptResultSchema,
    fallback: () => fallbackScript(topic),
    maxTokens: 3000,
  });

  return { script: polish(value, brand), source };
}

/** Clean up whatever came back so the renderer gets consistent input. */
function polish(script: ScriptResult, brand: BrandContext): ScriptResult {
  const banned = brand.bannedPhrases ?? [];
  const beats = script.beats.slice(0, 8).map((b, i) => ({
    ...b,
    narration: stripBannedOpeners(b.narration, banned),
    camera: b.camera?.trim() || cameraFor(i),
    onScreenText: (b.onScreenText || "").toUpperCase().slice(0, 28),
    seconds: clampBeat(b.seconds, i, script.beats.length),
  }));

  return {
    ...script,
    title: script.title.slice(0, 95),
    hook: beats[0]?.narration ?? script.hook,
    beats,
  };
}

function clampBeat(seconds: number, index: number, total: number): number {
  if (index === 0) return Math.min(Math.max(seconds, 3), 5);
  if (index === total - 1) return Math.min(Math.max(seconds, 3), 6);
  return Math.min(Math.max(seconds, 4), 9);
}

/**
 * No ANTHROPIC_API_KEY? Still ship a renderable short. Generic but correctly
 * shaped: right beat count, right pacing, hard button ending.
 */
function fallbackScript(topic: string): ScriptResult {
  const t = topic.trim().replace(/^(why|how|what)\s+/i, "");
  const subject = t.replace(/\.$/, "");

  const beats = [
    {
      seconds: 4,
      narration: `${cap(subject)} is happening right now, and almost nobody notices it.`,
      visualPrompt: `Extreme macro opening shot of ${subject}, something small moving unexpectedly in frame`,
      onScreenText: "RIGHT NOW",
    },
    {
      seconds: 6,
      narration: `Most people picture it as one simple step. That picture is wrong.`,
      visualPrompt: `A clean simplified diagram model of ${subject} floating in an empty studio void`,
      onScreenText: "WRONG MODEL",
    },
    {
      seconds: 7,
      narration: `Cut it open and there are layers, each one handing off to the next.`,
      visualPrompt: `Cross section cutaway of ${subject} peeling open to reveal internal layers`,
      onScreenText: "INSIDE",
    },
    {
      seconds: 7,
      narration: `One of those handoffs happens thousands of times before you finish this sentence.`,
      visualPrompt: `Insert macro shot of the fastest moving part of ${subject}, motion trails`,
      onScreenText: "THOUSANDS",
    },
    {
      seconds: 7,
      narration: `Break one link and the whole thing stalls within seconds.`,
      visualPrompt: `The mechanism of ${subject} seizing and stopping, dust settling`,
      onScreenText: "IT STOPS",
    },
    {
      seconds: 7,
      narration: `So actually it is not one step at all. It is a relay that never stops running.`,
      visualPrompt: `Wide reveal of ${subject} as a connected relay system, elements passing along a chain`,
      onScreenText: "A RELAY",
    },
    {
      seconds: 7,
      narration: `Every second of your day depends on that relay finishing on time.`,
      visualPrompt: `Epic wide hero shot of the complete ${subject} system working in sync`,
      onScreenText: "ON TIME",
    },
    {
      seconds: 4,
      narration: `And it has not missed once.`,
      visualPrompt: `Slow final push onto the heart of ${subject}, everything still moving`,
      onScreenText: "NOT ONCE",
    },
  ].map((b, i) => ({ ...b, camera: cameraFor(i) }));

  return {
    title: cap(subject).slice(0, 60),
    hook: beats[0].narration,
    caption: `${cap(subject)} — the part nobody explains. #shorts #explainer #howitworks`,
    description: `A 60 second look at ${subject}. Made with Cadence, powered by the Higgsfield API.`,
    tags: ["shorts", "explainer", "howitworks", "science", "3danimation", "facts", "curiosity", "education"],
    beats,
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { ZACH_STYLE_LOCK };

// ---------------------------------------------------------------------------
// Topic picker
// ---------------------------------------------------------------------------

const TOPIC_SYSTEM = `You pick topics for 60 second 3D explainer shorts.
Every topic is one mechanism that can be shown, not discussed: "why X happens",
"what happens if Y", "how Z actually works".
Physical, visual, slightly surprising. No opinions, no history lectures, no news.
No real named people. Nothing gory involving real humans.`;

export async function suggestZachTopics(params: {
  niche: string;
  count?: number;
}): Promise<{ topics: string[]; source: "llm" | "fallback" }> {
  const { niche, count = 10 } = params;
  const schema = z.object({ topics: z.array(z.string()).min(1) });

  const { value, source } = await generateJson({
    system: TOPIC_SYSTEM,
    prompt: `Niche: ${niche}\n\nGive ${count} topics. Each is a short phrase, not a title.\nJSON: { "topics": ["why ...", "what happens when ...", "how ... actually works"] }`,
    schema,
    fallback: () => ({ topics: TOPIC_BANK.slice(0, count) }),
    maxTokens: 1200,
  });

  return { topics: value.topics.slice(0, count), source };
}

/** Evergreen bank — keeps Fill next 7 days working with zero keys. */
export const TOPIC_BANK = [
  "why your leg falls asleep",
  "what happens to a package between the warehouse and your door",
  "how a zipper actually locks shut",
  "why bridges have gaps in them",
  "what happens inside a battery as it dies",
  "how your phone knows which way is up",
  "why bread goes stale faster in the fridge",
  "what happens when a plane hits turbulence",
  "how a lock recognises the right key",
  "why ice is slippery",
  "what your stomach does with a swallowed coin",
  "how noise cancelling headphones erase sound",
  "why paper cuts hurt more than knife cuts",
  "what happens in the first second of a lightning strike",
  "how a seed knows which way to grow",
];
