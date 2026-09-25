/**
 * Character identity. Train once, then the whole system runs on cadence.
 *
 * Path A — Soul ID: upload the owned photos, train, and pass the returned
 *          custom_reference_id into every Soul generation.
 * Path B — look book fallback (documented in the brief): if training is not in
 *          the catalog, generate one consistent set of stills from a locked
 *          appearance string and reuse those same URLs as references forever.
 *
 * Either way the rest of the app only ever reads `lookbookImageUrls`.
 */

import crypto from "node:crypto";
import { db, readList, writeList } from "@/lib/db";
import {
  createSoulId,
  generateSoulImage,
  isMock,
  type AspectRatio,
} from "@/lib/higgsfield";
import { hfConcurrency, mapPool } from "@/lib/pool";
import { UGC_STYLE_LOCK } from "@/lib/prompts";
import { materialize, mediaUrl } from "@/lib/storage";
import { estimateImagesUsd } from "@/lib/pricing";
import { BudgetError, recordSpend, spentThisWeekUsd, weeklyCapUsd } from "@/lib/spend";

/** Six frames that between them cover every shot the modes ever need. */
const LOOKBOOK_SHOTS = [
  {
    key: "portrait",
    prompt:
      "head and shoulders portrait, looking straight into the lens, plain warm grey background, even soft light",
  },
  {
    key: "selfie",
    prompt:
      "arm's length selfie talking to camera, sunlit bedroom behind, phone-camera framing, slight lens distortion",
  },
  {
    key: "three-quarter",
    prompt:
      "three quarter mid shot beside a large window, head turned toward the light, casual top",
  },
  {
    key: "holding",
    prompt:
      "chest-up shot holding a small object up into frame with both hands, kitchen counter behind",
  },
  {
    key: "street",
    prompt:
      "waist-up shot outdoors on a quiet street, overcast daylight, walking toward the camera",
  },
  {
    key: "desk",
    prompt:
      "seated at a desk under a warm lamp, leaning slightly toward the camera, softly blurred room behind",
  },
] as const;

/**
 * A locked appearance line. With a Soul ID this is belt-and-braces; without
 * one it is the entire face lock, so it must be identical on every call.
 */
export function appearanceLock(character: {
  id: string;
  name: string;
  styleNotes?: string | null;
}): string {
  if (character.styleNotes?.trim()) return character.styleNotes.trim();

  // Deterministic fictional identity, derived from the character id so it
  // never drifts between runs. Never a real person.
  const h = crypto.createHash("sha1").update(character.id).digest();
  const age = 24 + (h[0] % 14);
  const hair = ["dark shoulder-length", "short cropped dark", "wavy chestnut", "straight black"][h[1] % 4];
  const build = ["slim", "average", "athletic"][h[2] % 3];
  const wear = ["a plain charcoal crewneck", "a cream knit sweater", "a black t-shirt"][h[3] % 3];
  return `a fictional ${age} year old person of ${build} build with ${hair} hair, wearing ${wear}, friendly relaxed expression, consistent across every shot`;
}

export type LookbookResult = {
  soulId: string | null;
  lookbookImageUrls: string[];
  usedFallback: boolean;
};

export async function buildLookbook(params: {
  characterId: string;
  aspectRatio?: AspectRatio;
  onLog?: (m: string) => void | Promise<void>;
}): Promise<LookbookResult> {
  const { characterId, aspectRatio = "9:16", onLog } = params;
  const log = async (m: string) => {
    console.log(`[character ${characterId}] ${m}`);
    await onLog?.(m);
  };

  const character = await db.character.findUniqueOrThrow({ where: { id: characterId } });
  const sourceImages = readList(character.sourceImageUrls);

  // 1 ── try Soul ID training
  let soulId = character.soulId ?? null;
  if (!soulId && sourceImages.length >= 4) {
    await log(`training Soul ID on ${sourceImages.length} photos`);
    const trained = await createSoulId(sourceImages, { name: character.name });
    soulId = trained.soulId;
    await log(soulId ? `Soul ID ${soulId}` : "Soul ID training unavailable — using look book fallback");
  }

  // 2 ── generate the look book (a live Soul-image spend — guard + record it)
  const lock = appearanceLock(character);
  const lookbookEstimate = estimateImagesUsd(LOOKBOOK_SHOTS.length);
  if (!isMock() && weeklyCapUsd() > 0) {
    const spent = await spentThisWeekUsd(character.workspaceId);
    if (spent + lookbookEstimate > weeklyCapUsd()) {
      throw new BudgetError(
        `Weekly spend cap reached: the look book is ~$${lookbookEstimate.toFixed(2)}, ` +
          `already spent ~$${spent.toFixed(2)} of $${weeklyCapUsd().toFixed(2)} this week.`,
      );
    }
  }
  await log(`generating ${LOOKBOOK_SHOTS.length} look book stills${isMock() ? " (MOCK)" : ""}`);

  const urls = await mapPool(
    [...LOOKBOOK_SHOTS],
    hfConcurrency(),
    async (shot, i) => {
      const prompt = `${lock}. ${shot.prompt}. ${UGC_STYLE_LOCK}`;
      const [url] = await generateSoulImage({
        prompt,
        custom_reference_id: soulId,
        aspect_ratio: aspectRatio,
        num_images: 1,
        // Fixed seed per slot: reruns reproduce the same face.
        seed: seedFor(character.id, i),
      });
      const rel = `characters/${characterId}/lookbook-${shot.key}.jpg`;
      if (url.startsWith("/media/")) return url;
      await materialize(url, rel);
      return mediaUrl(rel);
    },
  );

  await db.character.update({
    where: { id: characterId },
    data: {
      soulId,
      lookbookImageUrls: writeList(urls),
      styleNotes: character.styleNotes || lock,
    },
  });

  await recordSpend(character.workspaceId, lookbookEstimate, {
    note: "look book",
  });

  return { soulId, lookbookImageUrls: urls, usedFallback: !soulId };
}

function seedFor(id: string, index: number): number {
  const h = crypto.createHash("sha1").update(`${id}:${index}`).digest();
  // Soul validates seed as 0..1,000,000 inclusive.
  return h.readUInt32BE(0) % 1_000_001;
}

/** The refs handed to Seedance for face-locked clips. Strongest frames first. */
export function faceRefs(character: { lookbookImageUrls: string }): string[] {
  const all = readList(character.lookbookImageUrls);
  const order = ["portrait", "selfie", "three-quarter"];
  const ranked = [
    ...order.flatMap((k) => all.filter((u) => u.includes(`lookbook-${k}`))),
    ...all,
  ];
  return [...new Set(ranked)].slice(0, 4);
}
