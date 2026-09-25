/**
 * Higgsfield client — the ONLY image/video generation provider in Cadence.
 *
 * Generation runs through the official SDK (`@higgsfield/client/v2`): its
 * `subscribe(model, { input, withPolling })` POSTs the flat body to
 * `https://api.higgsfield.ai/<model>` and polls `/requests/{id}/status` — the
 * same contract the fetch client used, so every request body here is unchanged.
 * The SDK handles auth, retries and polling.
 *
 * Server-only (the v2 SDK refuses to run in a browser). Credentials come from
 * HF_CREDENTIALS ("key-id:key-secret") or the legacy HF_API_KEY_ID / _SECRET.
 *
 * status ∈ queued | in_progress | nsfw | failed | completed
 * Outputs arrive as { images: [{url}], video: {url} }
 */

import { config as hfConfig, higgsfield } from "@higgsfield/client/v2";
import { mockImage, mockVideo } from "./mock-media";

export const HF_BASE = process.env.HF_API_BASE ?? "https://api.higgsfield.ai";

export type HfStatus =
  | "queued"
  | "in_progress"
  | "nsfw"
  | "failed"
  | "completed"
  | "canceled";

export type MediaOutput = { url: string };

export type RequestStatus = {
  status: HfStatus;
  request_id: string;
  status_url?: string;
  cancel_url?: string;
  error?: string | null;
  images?: MediaOutput[];
  video?: MediaOutput;
  audio?: MediaOutput;
  audios?: MediaOutput[];
};

const TERMINAL: HfStatus[] = ["completed", "failed", "nsfw", "canceled"];

export class HiggsfieldError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly path?: string,
  ) {
    super(message);
    this.name = "HiggsfieldError";
  }
}

/**
 * Credentials as "key-id:key-secret", from HF_CREDENTIALS (the SDK's format) or
 * the legacy HF_API_KEY_ID / HF_API_KEY_SECRET pair. Null when neither is set.
 * The value itself is never logged.
 */
function credentials(): string | null {
  const combined = process.env.HF_CREDENTIALS;
  if (combined && combined.includes(":")) return combined;
  const id = process.env.HF_API_KEY_ID;
  const secret = process.env.HF_API_KEY_SECRET;
  if (id && secret) return `${id}:${secret}`;
  return null;
}

/** MOCK=true (or missing credentials) renders locally with ffmpeg, no credits. */
export function isMock(): boolean {
  if (process.env.MOCK === "true") return true;
  if (process.env.MOCK === "false") return false;
  return !credentials();
}

function authHeader(): string {
  const c = credentials();
  if (!c) {
    throw new HiggsfieldError(
      "No Higgsfield credentials. Set HF_CREDENTIALS (key-id:key-secret) or " +
        "HF_API_KEY_ID / HF_API_KEY_SECRET, or set MOCK=true to run without credits.",
    );
  }
  return `Key ${c}`;
}

/** Configure the SDK once, lazily, from whichever credential form is present. */
let sdkConfigured = false;
function ensureConfigured(): void {
  if (sdkConfigured) return;
  const c = credentials();
  if (!c) {
    throw new HiggsfieldError(
      "No Higgsfield credentials. Set HF_CREDENTIALS (key-id:key-secret) or " +
        "HF_API_KEY_ID / HF_API_KEY_SECRET, or set MOCK=true to run without credits.",
    );
  }
  hfConfig({ credentials: c });
  sdkConfigured = true;
}

/** Read a status code off either an SDK error or our own HiggsfieldError. */
function statusOf(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as { statusCode?: number; status?: number };
    return e.statusCode ?? e.status;
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Low level
// ---------------------------------------------------------------------------

/** POST a generation request. Returns immediately with a `status_url` to poll. */
export async function submit(
  path: string,
  body: Record<string, unknown>,
): Promise<RequestStatus> {
  const url = path.startsWith("http") ? path : `${HF_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(prune(body)),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new HiggsfieldError(
      `POST ${path} -> ${res.status}: ${detail(text)}`,
      res.status,
      path,
    );
  }
  return JSON.parse(text) as RequestStatus;
}

/**
 * The model catalog moves (seedance 2.0 -> 2.5, face refs landing later).
 * Try each candidate path in order and fall through on 404/422 so a catalog
 * change degrades to the next best model instead of failing the job.
 */
export async function submitFirstAvailable(
  candidates: { path: string; body: Record<string, unknown> }[],
): Promise<RequestStatus> {
  let last: unknown;
  for (const c of candidates) {
    try {
      return await submit(c.path, c.body);
    } catch (err) {
      last = err;
      const code = err instanceof HiggsfieldError ? err.statusCode : undefined;
      if (code === 404 || code === 405 || code === 422) continue; // not in catalog / wrong shape
      throw err;
    }
  }
  throw last instanceof Error
    ? last
    : new HiggsfieldError("No candidate endpoint accepted the request");
}

/**
 * Poll `status_url` until terminal.
 * Docs recommend: start at 2s, ×1.5 backoff, cap 10s, 0–0.5s jitter.
 */
export async function poll(
  statusUrlOrRequestId: string,
  opts: { timeoutMs?: number; onTick?: (s: RequestStatus) => void } = {},
): Promise<RequestStatus> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
  const url = statusUrlOrRequestId.startsWith("http")
    ? statusUrlOrRequestId
    : `${HF_BASE}/requests/${statusUrlOrRequestId}/status`;

  const started = Date.now();
  let delay = 2000;

  for (;;) {
    if (Date.now() - started > timeoutMs) {
      throw new HiggsfieldError(`Timed out after ${timeoutMs}ms polling ${url}`);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: authHeader() },
        cache: "no-store",
      });
    } catch {
      await sleep(delay + Math.random() * 500);
      delay = Math.min(delay * 1.5, 10_000);
      continue; // network blip — retry with backoff
    }

    if (res.status === 401) {
      throw new HiggsfieldError("401 — invalid Higgsfield credentials", 401);
    }
    if (res.status === 404) {
      throw new HiggsfieldError(`404 — unknown request: ${url}`, 404);
    }
    if (res.status >= 500) {
      await sleep(delay + Math.random() * 500);
      delay = Math.min(delay * 1.5, 10_000);
      continue;
    }

    const status = (await res.json()) as RequestStatus;
    opts.onTick?.(status);

    if (TERMINAL.includes(status.status)) {
      if (status.status !== "completed") {
        throw new HiggsfieldError(
          `Generation ${status.status}${status.error ? `: ${status.error}` : ""}`,
        );
      }
      return status;
    }

    await sleep(delay + Math.random() * 500);
    delay = Math.min(delay * 1.5, 10_000);
  }
}

/**
 * Submit + poll through the official SDK. The model id is the path without its
 * leading slash; the body is sent flat as the SDK's `input`. `withPolling`
 * blocks until the request is terminal.
 */
export async function run(
  path: string,
  body: Record<string, unknown>,
): Promise<RequestStatus> {
  ensureConfigured();
  const model = path.replace(/^\//, "");
  const res = (await higgsfield.subscribe(model, {
    input: prune(body),
    withPolling: true,
  })) as unknown as RequestStatus;

  if (res.status !== "completed") {
    throw new HiggsfieldError(
      `Generation ${res.status}${res.error ? `: ${res.error}` : ""}`,
    );
  }
  return res;
}

/**
 * Try each candidate model in order; fall through only when a model is absent
 * or rejects the body shape (400/404/405/422), so a catalog change degrades to
 * the next best model. A genuine failure (nsfw, credits, auth) stops here.
 */
export async function runFirstAvailable(
  candidates: { path: string; body: Record<string, unknown> }[],
): Promise<RequestStatus> {
  let last: unknown;
  for (const c of candidates) {
    try {
      return await run(c.path, c.body);
    } catch (err) {
      last = err;
      const code = statusOf(err);
      if (code === 400 || code === 404 || code === 405 || code === 422) continue;
      throw err;
    }
  }
  throw last instanceof Error
    ? last
    : new HiggsfieldError("No candidate model accepted the request");
}

/** Cancel a queued request. */
export async function cancel(requestId: string): Promise<void> {
  await fetch(`${HF_BASE}/requests/${requestId}/cancel`, {
    method: "POST",
    headers: { Authorization: authHeader() },
  });
}

// ---------------------------------------------------------------------------
// File upload — turns a local buffer into a URL the models can read
// ---------------------------------------------------------------------------

type UploadTicket = {
  upload_url: string;
  public_url: string;
  upload_headers?: Record<string, string>;
};

/**
 * 1. ask for a presigned URL, 2. PUT the bytes, 3. hand back `public_url`.
 * Never send Higgsfield credentials to the presigned storage URL.
 */
export async function uploadFile(
  data: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const ticketRes = await fetch(`${HF_BASE}/files/generate-upload-url`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content_type: contentType }),
  });
  if (!ticketRes.ok) {
    throw new HiggsfieldError(
      `generate-upload-url -> ${ticketRes.status}: ${detail(await ticketRes.text())}`,
      ticketRes.status,
    );
  }
  const ticket = (await ticketRes.json()) as UploadTicket;

  const put = await fetch(ticket.upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType, ...(ticket.upload_headers ?? {}) },
    body: new Uint8Array(data),
  });
  if (!put.ok) {
    throw new HiggsfieldError(`upload PUT -> ${put.status}`, put.status);
  }
  return ticket.public_url;
}

// ---------------------------------------------------------------------------
// Soul — identity
// ---------------------------------------------------------------------------

export type AspectRatio =
  | "1:1"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "5:4"
  | "4:5"
  | "16:9"
  | "9:16"
  | "21:9";

/**
 * Train a Soul ID from 8–20 owned photos.
 *
 * Soul ID training is not in the public OpenAPI yet, so this is best-effort:
 * on failure the caller falls back to the look book strategy (generate a
 * consistent set of stills once, then pass those same URLs as references
 * forever). See `pipelines/character.ts`.
 */
export async function createSoulId(
  imageUrls: string[],
  opts: { name?: string } = {},
): Promise<{ soulId: string | null; raw?: RequestStatus }> {
  if (isMock()) return { soulId: `mock-soul-${Date.now().toString(36)}` };
  if (imageUrls.length < 4) {
    throw new HiggsfieldError("Soul ID training needs at least 4 photos");
  }

  try {
    const status = await runFirstAvailable([
      {
        path: "/higgsfield-ai/soul-id/train",
        body: { image_urls: imageUrls, name: opts.name },
      },
      {
        path: "/higgsfield-ai/soul/custom-reference",
        body: { image_urls: imageUrls, name: opts.name },
      },
    ]);
    const soulId =
      (status as unknown as { custom_reference_id?: string }).custom_reference_id ??
      status.request_id ??
      null;
    return { soulId, raw: status };
  } catch {
    // Catalog does not expose training — caller uses the look book fallback.
    return { soulId: null };
  }
}

export async function generateSoulImage(params: {
  prompt: string;
  custom_reference_id?: string | null;
  aspect_ratio?: AspectRatio;
  resolution?: "720p" | "1080p";
  num_images?: number;
  seed?: number;
}): Promise<string[]> {
  const {
    prompt,
    custom_reference_id,
    aspect_ratio = "9:16",
    resolution = "1080p",
    num_images = 1,
  } = params;

  if (isMock()) {
    const out: string[] = [];
    for (let i = 0; i < num_images; i++) {
      out.push(await mockImage({ prompt, aspectRatio: aspect_ratio, index: i }));
    }
    return out;
  }

  // Both Soul endpoints validate resolution as "720p" | "1080p".
  const body = {
    prompt,
    num_images,
    resolution,
    aspect_ratio,
    ...(custom_reference_id ? { custom_reference_id } : {}),
    // Soul accepts seed in 0..1,000,000.
    ...(params.seed !== undefined
      ? { seed: Math.min(Math.max(Math.floor(params.seed), 0), 1_000_000) }
      : {}),
  };

  const status = await runFirstAvailable([
    { path: "/higgsfield-ai/soul/v2/standard", body },
    { path: "/higgsfield-ai/soul/standard", body },
  ]);

  const urls = (status.images ?? []).map((i) => i.url);
  if (!urls.length) throw new HiggsfieldError("Soul returned no images");
  return urls;
}

// ---------------------------------------------------------------------------
// Seedance — motion
//
// Defaults tuned for cost: 720p source (the renderer upscales to 1080x1920) and
// callers request at most a 5s clip. Both are overridable per call.
// ---------------------------------------------------------------------------

export type VideoDuration = 3 | 5 | 10;

export async function seedanceTextToVideo(params: {
  prompt: string;
  duration?: VideoDuration;
  aspect_ratio?: AspectRatio;
  resolution?: "480p" | "720p" | "1080p";
}): Promise<string> {
  const {
    prompt,
    duration = 5,
    aspect_ratio = "9:16",
    resolution = "720p",
  } = params;

  if (isMock()) {
    return mockVideo({ prompt, seconds: duration, aspectRatio: aspect_ratio });
  }

  const status = await runFirstAvailable([
    {
      path: "/bytedance/seedance-2.5/text-to-video",
      body: { prompt, duration, aspect_ratio, resolution },
    },
    {
      path: "/bytedance/seedance-2.0/text-to-video",
      body: { prompt, duration, aspect_ratio, resolution },
    },
    {
      path: "/minimax/hailuo-2.3/standard/text-to-video",
      body: { prompt, duration },
    },
  ]);
  return requireVideo(status);
}

export async function seedanceImageToVideo(params: {
  prompt: string;
  image_url: string;
  duration?: VideoDuration;
  aspect_ratio?: AspectRatio;
  resolution?: "480p" | "720p" | "1080p";
  /** Optional continuity: hold the next beat's opening frame. */
  end_image_url?: string;
}): Promise<string> {
  const {
    prompt,
    image_url,
    duration = 5,
    aspect_ratio = "9:16",
    resolution = "1080p",
    end_image_url,
  } = params;

  if (isMock()) {
    return mockVideo({
      prompt,
      seconds: duration,
      aspectRatio: aspect_ratio,
      fromImageUrl: image_url,
    });
  }

  const seedanceBody = {
    prompt,
    image_url,
    duration,
    aspect_ratio,
    resolution,
    ...(end_image_url ? { end_image_url } : {}),
  };

  const status = await runFirstAvailable([
    { path: "/bytedance/seedance-2.5/image-to-video", body: seedanceBody },
    { path: "/bytedance/seedance-2.0/image-to-video", body: seedanceBody },
    // Confirmed in the public catalog — the safety net that always exists.
    {
      path: "/kling-video/v2.5-turbo/pro/image-to-video",
      body: {
        prompt,
        image_url,
        duration: duration >= 10 ? 10 : 5,
        negative_prompt: NEGATIVE_PROMPT,
      },
    },
    {
      path: "/minimax/hailuo-2.3/standard/image-to-video",
      body: { prompt, image_url },
    },
  ]);
  return requireVideo(status);
}

/**
 * Reference-to-video: the face-lock path for UGC. Pass the look book stills as
 * `image_urls` so the same person shows up in every clip.
 */
export async function seedanceRefToVideo(params: {
  prompt: string;
  image_urls?: string[];
  video_urls?: string[];
  audio_urls?: string[];
  duration?: VideoDuration;
  aspect_ratio?: AspectRatio;
  resolution?: "480p" | "720p" | "1080p";
}): Promise<string> {
  const {
    prompt,
    image_urls = [],
    video_urls,
    audio_urls,
    duration = 5,
    aspect_ratio = "9:16",
    resolution = "720p",
  } = params;

  if (isMock()) {
    // Callers pass identity refs first and the shot's own still last, so mock
    // animates the last one — otherwise every UGC clip would be the same frame.
    return mockVideo({
      prompt,
      seconds: duration,
      aspectRatio: aspect_ratio,
      fromImageUrl: image_urls[image_urls.length - 1],
    });
  }

  const body = {
    prompt,
    image_urls,
    video_urls,
    audio_urls,
    duration,
    aspect_ratio,
    resolution,
  };

  try {
    const status = await runFirstAvailable([
      { path: "/bytedance/seedance-2.5/reference-to-video", body },
      { path: "/bytedance/seedance-2.0/reference-to-video", body },
    ]);
    return requireVideo(status);
  } catch (err) {
    // Reference-to-video not in the catalog yet: degrade to image-to-video off
    // the strongest look book still. Face stays locked because the still does.
    if (!image_urls.length) throw err;
    return seedanceImageToVideo({
      prompt,
      image_url: image_urls[0],
      duration,
      aspect_ratio,
      resolution,
    });
  }
}

// ---------------------------------------------------------------------------

export const NEGATIVE_PROMPT =
  "extra faces, deformed hands, text, watermark, logo, subtitles, blurry, low quality, duplicate person";

function requireVideo(status: RequestStatus): string {
  const url = status.video?.url;
  if (!url) throw new HiggsfieldError("Model returned no video output");
  return url;
}

function prune(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== undefined && v !== null),
  );
}

function detail(text: string): string {
  try {
    const parsed = JSON.parse(text) as { detail?: string };
    return parsed.detail ?? text;
  } catch {
    return text.slice(0, 400);
  }
}
