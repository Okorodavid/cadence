import { db } from "./db";

/**
 * One workspace per install (MVP). Created on first read so a fresh clone can
 * go straight to /onboard without a seed step.
 */
export async function getWorkspace() {
  const existing = await db.workspace.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;

  return db.workspace.create({ data: { name: "My workspace" } });
}

export async function getWorkspaceContext() {
  const workspace = await getWorkspace();
  const [brandKit, character, cadences] = await Promise.all([
    db.brandKit.findFirst({ where: { workspaceId: workspace.id } }),
    db.character.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
    }),
    db.cadenceRule.findMany({ where: { workspaceId: workspace.id } }),
  ]);
  return { workspace, brandKit, character, cadences };
}
