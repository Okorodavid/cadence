import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { buildLookbook } from "@/pipelines/character";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Train (or retrain) the identity and regenerate the six look book stills. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { characterId?: string };
  const workspace = await getWorkspace();

  const character =
    (body.characterId &&
      (await db.character.findUnique({ where: { id: body.characterId } }))) ||
    (await db.character.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
    }));

  if (!character) {
    return NextResponse.json({ error: "Create a character first" }, { status: 404 });
  }

  try {
    const result = await buildLookbook({ characterId: character.id });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
