/**
 * Official Higgsfield SDK smoke test — Seedance 2.5 text-to-video.
 *
 * Run: `npm run hf:test`
 *
 * Credentials come from HF_CREDENTIALS in .env.local (format key-id:key-secret),
 * loaded at runtime and handed straight to the SDK. This file never reads,
 * prints, or logs the credential value.
 *
 * NOTE: a completed run makes a BILLABLE generation request.
 */

import { config as loadDotenv } from "dotenv";
import { config, higgsfield } from "@higgsfield/client/v2";

loadDotenv({ path: ".env.local" });

const MODEL = "bytedance/seedance-2.5/text-to-video";

async function main() {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials || !credentials.includes(":")) {
    console.error(
      "Blocked: HF_CREDENTIALS is missing or malformed in .env.local.\n" +
        "Set it locally as  HF_CREDENTIALS=key-id:key-secret  then run again.",
    );
    process.exit(1);
  }

  config({ credentials });

  console.log(`Submitting ${MODEL} …`);
  const result = await higgsfield.subscribe(MODEL, {
    input: {
      prompt: "A cinematic scene at sunset",
      duration: 5,
      resolution: "720p",
      aspect_ratio: "16:9",
    },
    withPolling: true,
  });

  // Only "completed" with a real URL counts as success. Everything else
  // (failed, canceled, nsfw/moderated, or completed-but-empty) is a failure.
  if (result.status !== "completed") {
    console.error(`Generation did not succeed. Status: ${result.status}`);
    process.exit(1);
  }

  const url = result.video?.url;
  if (!url) {
    console.error("Status completed but no video URL was returned.");
    process.exit(1);
  }

  console.log("Video URL:", url);
}

main().catch((err) => {
  // Print the message only — never the credential.
  console.error("Request error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
