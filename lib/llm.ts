/**
 * Claude — topics, scripts, titles, captions. Text only: every pixel and frame
 * in Cadence comes from Higgsfield.
 *
 * With no ANTHROPIC_API_KEY the caller's `fallback` runs instead, so the whole
 * app still produces a complete job offline.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ZodType, ZodTypeDef } from "zod";

export const LLM_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

export function hasLlm(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function generateJson<T>(params: {
  system: string;
  prompt: string;
  // ZodType<Output, Def, unknown> so schemas that use .default() still infer
  // T as the *parsed* type rather than the looser input type.
  schema: ZodType<T, ZodTypeDef, unknown>;
  fallback: () => T;
  maxTokens?: number;
}): Promise<{ value: T; source: "llm" | "fallback" }> {
  const { system, prompt, schema, fallback, maxTokens = 4000 } = params;

  if (!hasLlm()) return { value: fallback(), source: "fallback" };

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const msg = await anthropic().messages.create({
        model: LLM_MODEL,
        max_tokens: maxTokens,
        system: `${system}\n\nRespond with JSON only. No prose, no markdown fences.`,
        messages: [
          {
            role: "user",
            content:
              attempt === 0
                ? prompt
                : `${prompt}\n\nYour previous reply did not validate: ${lastError}\nReturn corrected JSON only.`,
          },
          // Prefill forces the model straight into the object.
          { role: "assistant", content: "{" },
        ],
      });

      const text =
        "{" +
        msg.content
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("")
          .trim();

      const parsed = schema.safeParse(extractJson(text));
      if (parsed.success) return { value: parsed.data, source: "llm" };
      lastError = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } catch (err) {
      lastError = (err as Error).message;
      break; // transport/auth problem — don't burn a second call
    }
  }

  console.warn(`[llm] falling back to template: ${lastError}`);
  return { value: fallback(), source: "fallback" };
}

function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* find the outermost object below */
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  throw new Error("No JSON object in model reply");
}
