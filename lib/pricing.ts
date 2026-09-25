/**
 * Rough cost estimates for Higgsfield generations, used only by the spend guard
 * and the "this week" meter. Higgsfield's API does not return a per-request
 * cost, and its published prices are thin, so these are conservative estimates
 * you can tune with env vars. They exist to cap runaway spend, not to bill.
 *
 *   PRICE_IMAGE_USD           per Soul still (default 0.094 — the one figure in
 *                             the docs: ~1.5 credits for a Soul v2 image)
 *   PRICE_VIDEO_USD_PER_SEC   per second of generated video (default 0.19 —
 *                             low end of third-party 720p tests)
 */

const num = (env: string, fallback: number) => {
  const v = Number(process.env[env]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export function priceImageUsd(): number {
  return num("PRICE_IMAGE_USD", 0.094);
}

export function priceVideoUsdPerSec(): number {
  return num("PRICE_VIDEO_USD_PER_SEC", 0.19);
}

/** Billed clip seconds for a beat — mirrors the 5s request cap in render.ts. */
export function billedClipSeconds(beatSeconds: number): number {
  return beatSeconds <= 3.2 ? 3 : 5;
}

/**
 * Estimated USD to render one job: one still + one clip per scene. UGC's
 * reference-to-video bills on the same basis. Look book generation is separate
 * (6 stills) and estimated where it runs.
 */
export function estimateJobUsd(scenes: { seconds: number }[]): number {
  const images = scenes.length * priceImageUsd();
  const videoSeconds = scenes.reduce((a, s) => a + billedClipSeconds(s.seconds), 0);
  return round(images + videoSeconds * priceVideoUsdPerSec());
}

export function estimateImagesUsd(count: number): number {
  return round(count * priceImageUsd());
}

export function round(usd: number): number {
  return Math.round(usd * 100) / 100;
}
