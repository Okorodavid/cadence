/**
 * Style locks and safety rails. Every image prompt in a mode gets the same
 * suffix — that is what makes eight separately generated beats look like one
 * film instead of eight stock images.
 */

export const ZACH_STYLE_LOCK =
  "stylized 3D cinematic animation, smooth plastic materials, bright even lighting, shallow depth of field, documentary insert shot, no text, no watermark, no real celebrity face";

export const UGC_STYLE_LOCK =
  "vertical smartphone photo, natural handheld framing, soft window light, authentic skin texture, slight motion blur, no text, no watermark, single person only";

export const FACELESS_STYLE_LOCK =
  "clean editorial b-roll still, cinematic color grade, shallow depth of field, no on-screen text, no watermark, no identifiable faces";

/** Motion verbs Seedance responds to. Cycled so the camera never repeats twice. */
export const CAMERA_MOVES = [
  "slow dolly in",
  "orbit right around the subject",
  "macro insert push",
  "slow push in, rack focus",
  "crane down to eye level",
  "slow dolly out revealing scale",
  "handheld drift left",
  "top-down descend",
] as const;

export function cameraFor(order: number): string {
  return CAMERA_MOVES[order % CAMERA_MOVES.length];
}

export function styleLockFor(mode: string): string {
  if (mode === "zach_short") return ZACH_STYLE_LOCK;
  if (mode === "ugc_ad") return UGC_STYLE_LOCK;
  return FACELESS_STYLE_LOCK;
}

/** Compose a beat's final image prompt: content first, style lock last. */
export function lockPrompt(visual: string, mode: string): string {
  const lock = styleLockFor(mode);
  const cleaned = visual.trim().replace(/[.\s]+$/, "");
  return `${cleaned}. ${lock}`;
}

// ---------------------------------------------------------------------------
// Topic guardrails
// ---------------------------------------------------------------------------

const BLOCKED = [
  { re: /\b(nude|nsfw|porn|sexual|erotic|onlyfans)\b/i, why: "sexual content" },
  { re: /\b(child|kid|minor|teen|toddler)s?\b.*\b(body|nude|sexy)\b/i, why: "minors" },
  {
    re: /\b(deepfake|impersonat\w*)\b|\b(elon musk|taylor swift|donald trump|joe biden)\b/i,
    why: "real-person likeness / deepfake",
  },
  {
    re: /\b(gore|dismember\w*|beheading|mutilat\w*|graphic injury|real autopsy)\b/i,
    why: "graphic real injury",
  },
  { re: /\bhow to (make|build) a (bomb|gun|explosive)\b/i, why: "weapons instructions" },
  { re: /\b(suicide|self[- ]harm) (method|how to)\b/i, why: "self-harm instructions" },
];

export type Guard = { ok: true } | { ok: false; reason: string };

/**
 * Explainers and curiosity facts only. Animated / medical-diagram level detail
 * is fine; live gore and real-person likeness are not.
 */
export function checkTopic(topic: string): Guard {
  for (const b of BLOCKED) {
    if (b.re.test(topic)) {
      return {
        ok: false,
        reason: `Topic rejected (${b.why}). Cadence generates explainers and curiosity facts only.`,
      };
    }
  }
  if (topic.trim().length < 4) {
    return { ok: false, reason: "Topic is too short to script." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------

export type BrandContext = {
  niche?: string;
  audience?: string;
  tone?: string;
  hookStyle?: string;
  cta?: string;
  bannedPhrases?: string[];
};

export function brandBlock(b: BrandContext): string {
  const lines = [
    b.niche && `Niche: ${b.niche}`,
    b.audience && `Audience: ${b.audience}`,
    b.tone && `Tone: ${b.tone}`,
    b.hookStyle && `Hook style: ${b.hookStyle}`,
    b.cta && `CTA: ${b.cta}`,
    b.bannedPhrases?.length &&
      `Never use these phrases: ${b.bannedPhrases.join(", ")}`,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "No brand kit set — use a neutral, direct voice.";
}

/** Phrases that mark a script as AI-written. Stripped post-generation. */
export const BANNED_OPENERS = [
  "welcome back",
  "hey guys",
  "in this video",
  "let's dive in",
  "buckle up",
  "have you ever wondered",
  "in today's video",
];

export function stripBannedOpeners(text: string, extra: string[] = []): string {
  let out = text;
  for (const phrase of [...BANNED_OPENERS, ...extra]) {
    const re = new RegExp(
      `^\\s*${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[,!.]?\\s*`,
      "i",
    );
    out = out.replace(re, "");
  }
  return out.trim();
}
