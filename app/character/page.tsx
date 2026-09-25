import { db, readJson, readList } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { CharacterStudio } from "@/components/character-studio";

export const dynamic = "force-dynamic";

export default async function CharacterPage() {
  const workspace = await getWorkspace();
  const character = await db.character.findFirst({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "asc" },
  });

  const clipCount = character
    ? await db.calendarJob.count({
        where: { characterId: character.id, videoUrl: { not: null } },
      })
    : 0;

  return (
    <CharacterStudio
      character={
        character
          ? {
              id: character.id,
              name: character.name,
              soulId: character.soulId,
              avatarUrl: character.avatarUrl,
              styleNotes: character.styleNotes,
              voiceId: character.voiceId,
              voiceSettings: readJson(character.voiceSettings, {}),
              lookbook: readList(character.lookbookImageUrls),
              sourceImages: readList(character.sourceImageUrls),
            }
          : null
      }
      clipCount={clipCount}
    />
  );
}
