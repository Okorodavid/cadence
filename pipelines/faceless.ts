/**
 * Faceless YouTube (Hurricane style). No talking head — b-roll plus VO.
 *
 * Two entry points:
 *   suggestIdeas()  — niche or 3 competitor titles -> 10 ideas with hooks
 *   writeFacelessScript() — idea -> script split into 5-8s visual beats
 */

import { generateJson } from "@/lib/llm";
import { brandBlock, cameraFor, stripBannedOpeners, type BrandContext } from "@/lib/prompts";
import { estimateSeconds } from "@/lib/tts";
import {
  IdeaListSchema,
  ScriptResultSchema,
  type Idea,
  type ScriptResult,
} from "./types";

const IDEA_SYSTEM = `You are a YouTube packaging strategist for faceless channels.
Every idea must have a curiosity gap: the title promises a specific answer the viewer cannot guess.
No listicles unless the number is odd and specific. No "top 10". No clickbait punctuation.
Titles are under 60 characters and use concrete nouns.`;

export async function suggestIdeas(params: {
  niche: string;
  competitorTitles?: string[];
  count?: number;
  brand: BrandContext;
}): Promise<{ ideas: Idea[]; source: "llm" | "fallback" }> {
  const { niche, competitorTitles = [], count = 10, brand } = params;

  const prompt = `Niche: ${niche}

${brandBlock(brand)}
${
  competitorTitles.length
    ? `\nTitles that are already working in this niche:\n${competitorTitles
        .map((t) => `- ${t}`)
        .join("\n")}\nFind the pattern behind them, then beat it. Do not copy them.`
    : ""
}

Give ${count} video ideas. JSON:
{ "ideas": [ { "topic": "what the video is about, one line", "title": "the YouTube title", "hook": "the first spoken sentence, a pattern interrupt", "why": "the curiosity gap in 8 words" } ] }`;

  const { value, source } = await generateJson({
    system: IDEA_SYSTEM,
    prompt,
    schema: IdeaListSchema,
    fallback: () => ({ ideas: fallbackIdeas(niche, count) }),
    maxTokens: 2500,
  });

  return { ideas: value.ideas.slice(0, count), source };
}

// ---------------------------------------------------------------------------

const SCRIPT_SYSTEM = `You write faceless YouTube voiceover scripts.

Hard rules:
- Never open with "welcome back", "hey guys", "in this video", or a question about the viewer's day.
- The first sentence is a pattern interrupt: a claim, a number, or a scene.
- Open a new curiosity loop roughly every 45 seconds and close the previous one.
- Conversational. Contractions. Second person. Sentences under 20 words.
- No filler transitions ("moving on", "but first"). No sponsor slots.
- End on the payoff, not a sign-off.

Each beat is one visual and 5-8 seconds of narration.
visualPrompt describes ONE filmable b-roll shot — no people's faces, no on-screen text.
Do not include style words; the renderer appends a fixed style lock.`;

export async function writeFacelessScript(params: {
  topic: string;
  title?: string;
  brand: BrandContext;
  /** "short" = 45-60s, "long" = 8-12 min. */
  length?: "short" | "long";
}): Promise<{ script: ScriptResult; source: "llm" | "fallback" }> {
  const { topic, title, brand, length = "short" } = params;

  // Long-form at full length would be 100+ beats. The MVP renders a scripted
  // draft: full script text plus the first ~24 beats as a cut-down visual pass.
  const beatCount = length === "long" ? 24 : 10;
  const spec =
    length === "long"
      ? "This is the opening 3 minutes of an 8-12 minute video. Write the strongest 24 beats."
      : "Total narration reads aloud in 45-60 seconds.";

  const prompt = `Topic: ${topic}
${title ? `Working title: ${title}` : ""}

${brandBlock(brand)}

${spec}
Write exactly ${beatCount} beats.

JSON:
{
  "title": "YouTube title under 60 chars",
  "hook": "first spoken sentence",
  "caption": "community post caption",
  "description": "3 sentence YouTube description",
  "tags": ["10 lowercase tags"],
  "beats": [ { "seconds": 6, "narration": "...", "visualPrompt": "...", "camera": "slow dolly in", "onScreenText": "" } ]
}`;

  const { value, source } = await generateJson({
    system: SCRIPT_SYSTEM,
    prompt,
    schema: ScriptResultSchema,
    fallback: () => fallbackScript(topic, title, beatCount),
    maxTokens: length === "long" ? 8000 : 3500,
  });

  const banned = brand.bannedPhrases ?? [];
  return {
    script: {
      ...value,
      beats: value.beats.map((b, i) => ({
        ...b,
        narration: stripBannedOpeners(b.narration, banned),
        camera: b.camera?.trim() || cameraFor(i),
        seconds: Math.min(Math.max(b.seconds, 4), 9),
      })),
    },
    source,
  };
}

/** Flatten beats back into a readable script for the review screen. */
export function beatsToScript(beats: { narration: string }[]): string {
  return beats.map((b) => b.narration).join("\n\n");
}

// ---------------------------------------------------------------------------

function fallbackIdeas(niche: string, count: number): Idea[] {
  const frames = [
    { t: `The ${niche} mistake that costs the most`, h: `Most people in ${niche} lose money on the same single step.` },
    { t: `What ${niche} looked like before the rules changed`, h: `Ten years ago this was legal. Then one filing changed it.` },
    { t: `The ${niche} number nobody publishes`, h: `There is a figure in ${niche} that never makes the headlines.` },
    { t: `Why ${niche} stopped working in 2024`, h: `The thing that worked for a decade quietly broke.` },
    { t: `The cheapest way into ${niche}`, h: `You do not need the budget everyone says you need.` },
    { t: `${niche}: what the pros do differently`, h: `The gap is not talent. It is one habit.` },
    { t: `The hidden cost inside ${niche}`, h: `Every invoice in this space hides the same line item.` },
    { t: `How ${niche} actually makes money`, h: `The product is not the product.` },
    { t: `The ${niche} rule that breaks everything`, h: `Follow this rule and nothing else matters.` },
    { t: `What happens when ${niche} fails`, h: `It does not collapse. It stalls, and that is worse.` },
  ];
  return frames.slice(0, count).map((f) => ({
    topic: f.t,
    title: clipWords(f.t, 60),
    hook: f.h,
    why: "specific claim, unresolved",
  }));
}

/** Trim to a length without leaving a half-word ("...before th"). */
function clipWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

function fallbackScript(
  topic: string,
  title: string | undefined,
  beatCount: number,
): ScriptResult {
  const t = topic.replace(/\.$/, "");
  const lines = [
    `There is one part of ${t} that almost nobody explains properly.`,
    `Start with what you already believe about it. It is close, but it is not right.`,
    `The version you were told skips a step. That step is where all the value sits.`,
    `Here is what actually happens, in order.`,
    `First, the input arrives — and it is already different from what you assume.`,
    `Second, it gets sorted. This is the part that decides everything downstream.`,
    `Third, it moves, and the timing here is tighter than it looks.`,
    `Now hold that thought, because the next part changes the whole picture.`,
    `The cost of getting this wrong is not the money. It is the time you cannot get back.`,
    `Once you see the sorting step, you cannot unsee it.`,
    `Which brings us to the question everyone should be asking.`,
    `Who decided the order in the first place?`,
    `The answer is older than the industry.`,
    `And it explains why every attempt to fix this has failed the same way.`,
    `Watch what happens when one link in the chain slows down.`,
    `Everything behind it queues. Nothing in front of it notices.`,
    `That lag is the whole story.`,
    `Fix the lag and the rest fixes itself.`,
    `Most people attack the last step instead. It feels productive.`,
    `It is not.`,
    `So the move is simple, even if it is not easy.`,
    `Find the sorting step. Measure it. Then shorten it.`,
    `That is the entire edge.`,
    `And it has been sitting in plain sight the whole time.`,
  ];

  const beats = Array.from({ length: beatCount }, (_, i) => {
    const narration = lines[i % lines.length];
    return {
      seconds: Math.min(9, Math.max(4, estimateSeconds(narration))),
      narration,
      visualPrompt: `Editorial b-roll for ${t}: shot ${i + 1}, close detail of the subject in a real environment, no faces`,
      camera: cameraFor(i),
      onScreenText: "",
    };
  });

  return {
    title: (title || `The part of ${t} nobody explains`).slice(0, 60),
    hook: beats[0].narration,
    caption: `New one on ${t}.`,
    description: `A breakdown of ${t}, start to finish. Made with Cadence, powered by the Higgsfield API.`,
    tags: [t.toLowerCase().split(/\s+/)[0] ?? "explainer", "explainer", "breakdown", "documentary", "howitworks"],
    beats,
  };
}
