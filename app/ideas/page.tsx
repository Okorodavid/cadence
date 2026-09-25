import { getWorkspaceContext } from "@/lib/workspace";
import { IdeaPicker } from "@/components/idea-picker";

export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const { brandKit } = await getWorkspaceContext();
  return <IdeaPicker defaultNiche={brandKit?.niche ?? ""} />;
}
