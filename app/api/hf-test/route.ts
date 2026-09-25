import { NextResponse } from "next/server";
import { isMock, seedanceTextToVideo } from "@/lib/higgsfield";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Seedance 2.5 smoke test, run through the app's own Higgsfield client (the
 * official SDK). POST to trigger it. In MOCK it returns a local placeholder
 * (no spend); with live credentials it makes a BILLABLE generation request.
 *
 * Behind the APP_PASSWORD gate like every other page.
 */
export async function POST() {
  try {
    const url = await seedanceTextToVideo({
      prompt: "A cinematic scene at sunset",
      duration: 5,
      aspect_ratio: "16:9",
      resolution: "720p",
    });
    return NextResponse.json({ ok: true, mock: isMock(), url });
  } catch (err) {
    return NextResponse.json(
      { ok: false, mock: isMock(), error: (err as Error).message },
      { status: 502 },
    );
  }
}
