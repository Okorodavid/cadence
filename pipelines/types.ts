import { z } from "zod";

export const BeatSchema = z.object({
  seconds: z.number().min(1).max(20).default(6),
  narration: z.string().min(1),
  visualPrompt: z.string().min(1),
  camera: z.string().default("slow push in"),
  onScreenText: z.string().default(""),
});

export type Beat = z.infer<typeof BeatSchema>;

export const ScriptResultSchema = z.object({
  title: z.string().min(1),
  hook: z.string().min(1),
  caption: z.string().default(""),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  beats: z.array(BeatSchema).min(3),
});

export type ScriptResult = z.infer<typeof ScriptResultSchema>;

export const IdeaSchema = z.object({
  topic: z.string(),
  title: z.string(),
  hook: z.string(),
  why: z.string().default(""),
});

export type Idea = z.infer<typeof IdeaSchema>;

export const IdeaListSchema = z.object({ ideas: z.array(IdeaSchema).min(1) });

export type Mode = "ugc_ad" | "faceless_yt" | "zach_short";

export const MODES: Mode[] = ["ugc_ad", "faceless_yt", "zach_short"];

export const MODE_LABELS: Record<Mode, string> = {
  ugc_ad: "UGC ad",
  faceless_yt: "Faceless YT",
  zach_short: "3D short",
};

export type JobStatus =
  | "idea"
  | "scripted"
  | "rendering"
  | "review"
  | "ready"
  | "failed";

export const STATUS_ORDER: JobStatus[] = [
  "idea",
  "scripted",
  "rendering",
  "review",
  "ready",
  "failed",
];
