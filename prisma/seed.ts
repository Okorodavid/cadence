/**
 * Seeds a workspace that looks used: a character with a look book, a brand
 * kit, cadence rules, and a week of jobs across all three modes.
 *
 *   npm run setup     # generate + push + seed
 *   npm run worker:once   # then render everything
 */

import { loadEnv } from "../lib/env";
loadEnv();

import fs from "node:fs";
import path from "node:path";

import { db, writeList } from "../lib/db";
import { buildLookbook } from "../pipelines/character";
import { addDays, startOfWeek } from "../lib/schedule";
import { TOPIC_BANK } from "../pipelines/zach";

const WORKSPACE = "Cadence Demo";

async function main() {
  console.log("Seeding…");

  await db.workspace.deleteMany({ where: { name: WORKSPACE } });

  const workspace = await db.workspace.create({ data: { name: WORKSPACE } });

  await db.brandKit.create({
    data: {
      workspaceId: workspace.id,
      niche: "how everyday things actually work",
      audience: "curious 18-34s who watch shorts before bed",
      tone: "calm, direct, no hype",
      rpmCategory: "education",
      hookStyle: "state the surprising fact first, explain second",
      bannedPhrases: writeList([
        "welcome back",
        "guys",
        "mind-blowing",
        "you won't believe",
        "let that sink in",
      ]),
      cta: "Follow for one of these a day.",
      colors: writeList(["#0B0F1A", "#FFD54A", "#FF5B4A", "#F7F7F5"]),
    },
  });

  const character = await db.character.create({
    data: {
      workspaceId: workspace.id,
      name: "Mara",
      styleNotes:
        "a fictional 29 year old person of average build with dark shoulder-length hair, wearing a plain charcoal crewneck, friendly relaxed expression, consistent across every shot",
      sourceImageUrls: writeList([]),
      // Keep a previously set profile photo across re-seeds.
      avatarUrl: fs.existsSync(path.join(process.cwd(), "public/media/characters/avatar/avatar.jpg"))
        ? "/media/characters/avatar/avatar.jpg"
        : null,
    },
  });

  console.log("  building look book…");
  const lookbook = await buildLookbook({ characterId: character.id });
  console.log(
    `  ${lookbook.lookbookImageUrls.length} stills${lookbook.usedFallback ? " (look book fallback — no Soul ID)" : ` (Soul ID ${lookbook.soulId})`}`,
  );

  await db.cadenceRule.createMany({
    data: [
      { workspaceId: workspace.id, mode: "zach_short", perWeek: 7 },
      { workspaceId: workspace.id, mode: "ugc_ad", perWeek: 3 },
      { workspaceId: workspace.id, mode: "faceless_yt", perWeek: 2 },
    ],
  });

  // A week that starts on Monday, so the grid is full either side of today.
  const monday = startOfWeek(new Date());
  const plan: {
    offset: number;
    mode: "zach_short" | "ugc_ad" | "faceless_yt";
    topic: string;
    hour: number;
  }[] = [];

  for (let d = 0; d < 7; d++) {
    plan.push({ offset: d, mode: "zach_short", topic: TOPIC_BANK[d], hour: 18 });
  }
  for (const [i, d] of [0, 3, 5].entries()) {
    plan.push({
      offset: d,
      mode: "ugc_ad",
      topic: ["standing desk converter", "cold brew maker", "blue light glasses"][i],
      hour: 12,
    });
  }
  for (const [i, d] of [1, 4].entries()) {
    plan.push({
      offset: d,
      mode: "faceless_yt",
      topic: [
        "the shipping container that changed global trade",
        "why every supermarket has the same floor plan",
      ][i],
      hour: 16,
    });
  }

  for (const p of plan) {
    const date = addDays(monday, p.offset);
    const scheduledAt = new Date(date);
    scheduledAt.setHours(p.hour, 0, 0, 0);

    await db.calendarJob.create({
      data: {
        workspaceId: workspace.id,
        characterId: p.mode === "ugc_ad" ? character.id : null,
        date,
        mode: p.mode,
        status: "idea",
        topic: p.topic,
        scheduledAt,
        inputs:
          p.mode === "ugc_ad"
            ? JSON.stringify({
                productName: p.topic,
                offer: "20% off this week with code CADENCE",
              })
            : p.mode === "faceless_yt"
              ? JSON.stringify({ length: "short" })
              : "{}",
      },
    });
  }

  console.log(`  ${plan.length} jobs across 7 days`);
  console.log("\nDone. Next:  npm run worker:once   then   npm run dev");
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
