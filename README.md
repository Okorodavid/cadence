# Cadence — AI Influencer + YouTube OS

Set a character and a schedule. Cadence produces the posts and videos on a
calendar and exports them ready to publish.

It is a **job system, not a studio**. There is no "generate" button on the home
page — the home page is a calendar. You tell it *1 short a day, 3 UGC ads a
week, 2 faceless videos a week*, press **Fill next 7 days**, and come back to a
queue of finished cuts to approve.

All image and video generation goes through the **Higgsfield API**.

---

## Three modes, one character

| Mode | What it makes | Beats |
|---|---|---|
| `zach_short` | 40–60s 9:16 3D explainer. Hook in 2s, constant motion, one idea, hard cut ending. | 8 |
| `ugc_ad` | 3 vertical clips, 8–15s, the *same* face every time, product in hand. | 3 |
| `faceless_yt` | B-roll + VO, pattern-interrupt open, a new curiosity loop every 45s. **Coming soon** — gated off for new jobs; flip `comingSoon` in `lib/ui.ts` to re-enable. | 10–24 |

They share one character, one brand kit, and one calendar. Train the identity
once; the system then runs on cadence.

---

## Quick start

Requires **Node 20+** and **ffmpeg on PATH** (`ffmpeg -version` must work).

**One command (recommended).** On Windows, double-click `start-cadence.bat`. Anywhere else:

```bash
npm run dev:all -- --open
```

`dev:all` handles first-run setup on its own: it installs dependencies, creates
`.env` from `.env.example`, and creates and seeds the database. It then starts
the app and the job worker together and opens the browser. Ctrl+C (or closing
the window) stops both. If port 3000 is already taken, it says so and exits.

**By hand**, if you prefer separate terminals:

```bash
npm install
cp .env.example .env
npm run setup     # prisma generate + db push + seed a demo workspace
npm run worker    # in a second terminal — renders the queue
npm run dev       # http://localhost:3000
```

`npm run setup` seeds a character with a look book, a brand kit, cadence rules,
and 12 jobs across the current week. The worker picks them up and renders them.

To render everything up front and exit instead of watching:

```bash
npm run worker:once
```

### It runs on $0

With **no API keys at all** the app still produces complete, playable videos:

| Piece | With keys | Without |
|---|---|---|
| Stills & motion | Higgsfield Soul + Seedance | `MOCK=true` — ffmpeg renders real gradient cards and camera moves |
| Scripts, topics, titles | Claude | built-in template writers |
| Narration | ElevenLabs | Windows SAPI (free, offline), else timed silence |

Every stage still runs for real — conform, stitch, VO mux, caption burn,
thumbnail pick, export zip. Flip `MOCK=false` and add Higgsfield keys when you
want the real pixels; nothing else changes.

---

## Where the keys go

All of it lives in `.env` (git-ignored). Nothing is ever exposed to the browser —
Higgsfield is only ever called from a route handler or the worker process.

```ini
HF_API_KEY_ID=
HF_API_KEY_SECRET=
HF_CONCURRENCY=2          # parallel Higgsfield requests; start at 2

MOCK=true                 # false = spend credits

SPEND_CAP_USD_PER_WEEK=30  # weekly cap on live generation; 0/unset = uncapped

ANTHROPIC_API_KEY=        # scripts and topics only, never pixels
ELEVENLABS_API_KEY=       # optional; Windows SAPI is the free fallback

DATABASE_URL="file:./dev.db"
MEDIA_ROOT=               # blank = public/media; set to a volume in production

APP_PASSWORD=             # blank = no login gate
AUTO_APPROVE=false        # true = finished renders skip review and go to ready
```

Get keys at <https://console.higgsfield.ai>. Auth is
`Authorization: Key ${HF_API_KEY_ID}:${HF_API_KEY_SECRET}`.

---

## Production

```bash
npm run start:all         # build (if needed) + next start + worker, supervised
```

On Windows, double-click `start-cadence-prod.bat`. The script builds the app,
runs first-time DB setup, then starts `next start` and the job worker together.
Each is restarted on crash (capped backoff), so a transient failure doesn't take
the site or the render queue down. Ctrl+C stops both. On a VPS you can instead
run `npm run start` and `npm run worker` under pm2 or systemd.

Two things production needs that dev doesn't:

- **`MEDIA_ROOT`** — renders and uploads created after `next build` are served by
  the `/media/[...path]` route (with HTTP range, so videos scrub). Point
  `MEDIA_ROOT` at a path outside the repo — a mounted volume — so media survives
  redeploys.
- **`APP_PASSWORD`** — set it before any public URL. Blank means no login gate,
  and anyone with the link can spend your API credits.

## Spend guard

`SPEND_CAP_USD_PER_WEEK` caps live Higgsfield spend per week. A job (or a look
book) that would exceed the cap is refused *before* any API call, and lands in
`failed` with the reason. MOCK spends nothing, so the guard is a no-op there.
Estimates come from `lib/pricing.ts` (`PRICE_IMAGE_USD`,
`PRICE_VIDEO_USD_PER_SEC`) — tune them to the real prices on your console. The
calendar header shows a live meter: `~$X / $cap` this week.

For a bounded manual test, **Fill 1 day** creates jobs for just the next open
day (one 3D short + one UGC), instead of a whole week — the safe first live run.

---

## How a job runs

```
idea ──▶ scripted ──▶ rendering ──▶ review ──▶ ready
                                      └── failed (error kept on the row)
```

1. **Topic** — picked from your niche, or typed in by hand.
2. **Script** — Claude writes it and splits it into beats (narration, visual
   prompt, camera move, on-screen text).
3. **Narration first** — TTS runs before any visuals, and the *measured wav
   length* becomes each beat's length. That is what keeps picture and audio
   locked beat-for-beat without forced alignment.
4. **Stills** — Higgsfield Soul, one per beat, with the mode's style lock
   appended to every prompt.
5. **Motion** — Higgsfield Seedance image-to-video (reference-to-video for UGC,
   so the face stays locked), two at a time.
6. **Assembly** — ffmpeg conforms every clip to its measured beat length,
   concats, muxes the VO, burns the captions.
7. **Package** — highest-contrast frame becomes the thumbnail, plus srt, title,
   description, tags and a publish checklist.

Every step is idempotent. A beat that already has a clip is skipped, so
*Regenerate scene 4* costs exactly one scene.

---

## Screens

| Route | What it is |
|---|---|
| `/calendar` | **Home.** Week grid, job cards by status, Fill next 7 days. |
| `/ideas` | Topic picker: a niche or 3 competitor titles into 10 ideas, batch-scheduled. |
| `/jobs/[id]` | Script, scene timeline, per-scene regenerate, preview, packaging. |
| `/character` | Training photos, Soul ID, the look book wall. |
| `/assets` | Every still, clip, cut, voiceover and caption file the pipeline made. |
| `/onboard` | Brand kit and the per-week cadence rates. |
| `/export` | Every finished piece, grouped by day, one-click packs. |

---

## The export pack

YouTube OAuth upload is deliberately **not** in the MVP. Cadence hands you a zip
and a checklist instead:

```
your-title.mp4
captions.srt
thumbnail.jpg
voiceover.wav
title.txt  description.txt  tags.txt  script.txt
metadata.json
publish-checklist.md
```

`GET /api/jobs/<id>/export` for one job, `GET /api/export?date=YYYY-MM-DD` for a
whole day.

---

## Identity: Soul ID, with a look book fallback

`POST /api/character/lookbook` tries Soul ID training on the uploaded photos and
passes the resulting `custom_reference_id` into every Soul generation.

Soul ID training is not in the public catalog yet, so there is a documented
fallback: generate six stills **once** from a locked appearance string with a
fixed per-slot seed, then reuse those same URLs as Seedance references forever.
Either way the rest of the app only reads `lookbookImageUrls`, so the face is
locked the same way in both cases.

Upload only photos of a person whose likeness you own.

---

## Higgsfield client

`lib/higgsfield.ts` runs generation through the **official SDK**
(`@higgsfield/client/v2`): `subscribe(model, { input, withPolling })` POSTs the
flat body to `api.higgsfield.ai/<model>` and polls to completion. The app's
functions keep the same signatures, so the pipeline is unchanged:

```ts
createSoulId(imageUrls)                       // best-effort, falls back cleanly
generateSoulImage({ prompt, custom_reference_id, aspect_ratio, num_images, seed })
seedanceTextToVideo({ prompt, duration, aspect_ratio, resolution })
seedanceImageToVideo({ prompt, image_url, duration, aspect_ratio })
seedanceRefToVideo({ prompt, image_urls, video_urls, audio_urls })
uploadFile(buffer, contentType)               // presign -> PUT -> public_url
poll(statusUrl)                               // 2s -> ×1.5 -> cap 10s, jittered
```

Two details worth knowing:

- **Credentials.** `HF_CREDENTIALS` (`key-id:key-secret`, the SDK format) or the
  legacy `HF_API_KEY_ID` / `HF_API_KEY_SECRET`. Either works. `MOCK=true` (or no
  credentials) skips the SDK entirely and renders locally.
- **The catalog moves.** Seedance defaults to **2.5** (text- and image-to-video),
  then falls through on 400/404/405/422 to 2.0, then Kling 2.5 Turbo / Hailuo. A
  catalog change degrades the output; it does not fail the job.

**Run the Seedance 2.5 test:**

- Standalone: put `HF_CREDENTIALS=key-id:key-secret` in `.env.local`, then
  `npm run hf:test` (runs [index.ts](index.ts) via the SDK directly).
- From the app: log in, then `POST /api/hf-test` — same test through the app's
  own client. Billable with live credentials; a local placeholder under MOCK.

---

## Guardrails

Explainers and curiosity facts only. `lib/prompts.ts` rejects topics involving
sexual content, minors, real-person likeness/deepfakes, and graphic real injury
before a job is ever scripted. Animated and medical-diagram level detail is
fine; live gore is not.

---

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind v4 · Prisma · SQLite · ffmpeg ·
Higgsfield API · Claude for text.

SQLite is the local default. The schema uses no arrays or enums, so switching
`provider` to `postgresql` and pointing `DATABASE_URL` at Postgres works
unchanged.

```
lib/higgsfield.ts   the only generation provider
lib/ffmpeg.ts       conform / concat / mux / burn / thumbnail scoring
lib/captions.ts     .ass (burned) + .srt (sidecar)
lib/tts.ts          elevenlabs | sapi | silent
lib/schedule.ts     Fill next 7 days
pipelines/render.ts the shared renderer
pipelines/zach.ts   the 8-beat short
worker/index.ts     the queue
```

---

## Demo

```bash
npm run setup     # character + brand kit + a week of jobs
npm run demo      # render everything, then approve most of it
npm run dev
```

`npm run demo:rerender` re-assembles every finished job from the cached stills
and clips — useful after changing the caption style or the thumbnail rule, since
it does not re-spend a single generation.

The run to record:

1. **/character** — the look book wall. One identity, six locked references.
2. **/calendar** — seven days full, statuses mixed, nothing empty.
3. **A UGC ad** — play two clips back to back, same face.
4. **A 3D short** — start to finish, hook to hard cut.
5. **/export** — open a pack: mp4, srt, thumbnail, checklist.
6. The provider pills in the header read *Higgsfield*.

---

## Notes

- **Windows:** captions need a bold system font. Cadence copies one out of
  `C:/Windows/Fonts` automatically; override with `CAPTION_FONT_PATH`.
- Higgsfield output URLs expire, so every result is mirrored into local storage
  the first time it is touched. That is what makes the export zip self-contained.
- Concurrency starts at 2. Raise `HF_CONCURRENCY` once your key allows more.
