/**
 * Caption builder. Turns timed narration into:
 *  - an .ass track for burned-in big centered captions (shorts)
 *  - an .srt sidecar for the export pack / YouTube
 */

import { CAPTION_FONT_NAME, VIDEO_H, VIDEO_W } from "./ffmpeg";

export type TimedScene = {
  start: number;
  end: number;
  narration: string;
};

export type Cue = { start: number; end: number; text: string };

/**
 * Split narration into 3–5 word chunks and spread them across the beat by
 * word count, so captions track the voice without needing forced alignment.
 */
export function chunkNarration(scene: TimedScene, wordsPerCue = 4): Cue[] {
  const words = scene.narration.trim().split(/\s+/).filter(Boolean);
  const span = Math.max(0.4, scene.end - scene.start);
  if (!words.length) return [];

  const groups: string[][] = [];
  for (let i = 0; i < words.length; i += wordsPerCue) {
    groups.push(words.slice(i, i + wordsPerCue));
  }
  // Avoid a lonely trailing word.
  if (groups.length > 1 && groups[groups.length - 1].length === 1) {
    const last = groups.pop()!;
    groups[groups.length - 1].push(...last);
  }

  const total = words.length;
  let cursor = scene.start;
  return groups.map((g) => {
    const dur = (g.length / total) * span;
    const cue = { start: cursor, end: cursor + dur, text: g.join(" ") };
    cursor += dur;
    return cue;
  });
}

export function buildCues(scenes: TimedScene[], wordsPerCue = 4): Cue[] {
  return scenes.flatMap((s) => chunkNarration(s, wordsPerCue));
}

// ---------------------------------------------------------------------------

function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(
    c,
  ).padStart(2, "0")}`;
}

function srtTime(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    s,
  ).padStart(2, "0")},${String(r).padStart(3, "0")}`;
}

export type CaptionStyle = "center-punch" | "lower-third";

/**
 * `center-punch` — the shorts look: huge, centered, heavy outline.
 * `lower-third` — long-form: smaller, sits above the bottom safe area.
 */
export function buildAss(
  cues: Cue[],
  style: CaptionStyle = "center-punch",
  accentHex = "#FFD54A",
): string {
  const big = style === "center-punch";
  const fontSize = big ? 104 : 64;
  const alignment = big ? 5 : 2; // 5 = middle center, 2 = bottom center
  const marginV = big ? 0 : 220;
  const primary = assColor("#FFFFFF");
  const outline = assColor("#000000");
  const accent = assColor(accentHex);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${VIDEO_W}
PlayResY: ${VIDEO_H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Punch,${CAPTION_FONT_NAME},${fontSize},${primary},${accent},${outline},${outline},-1,0,0,0,100,100,2,0,1,${
    big ? 7 : 5
  },${big ? 3 : 2},${alignment},90,90,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const lines = cues.map((c) => {
    const text = escapeAss(c.text);
    // Tiny pop on entry — reads as "constantly moving" without a motion pass.
    const fx = big ? `{\\fad(60,60)\\fscx92\\fscy92\\t(0,120,\\fscx100\\fscy100)}` : `{\\fad(80,80)}`;
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Punch,,0,0,0,,${fx}${text}`;
  });

  return [header, ...lines, ""].join("\n");
}

export function buildSrt(cues: Cue[]): string {
  return (
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`,
      )
      .join("\n") + "\n"
  );
}

function escapeAss(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

/** #RRGGBB -> &HAABBGGRR (ASS is BGR with an inverted alpha byte). */
function assColor(hex: string, alpha = 0): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  const a = alpha.toString(16).padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}
