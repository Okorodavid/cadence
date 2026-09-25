import { readList } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/workspace";
import { BrandForm } from "@/components/brand-form";

export const dynamic = "force-dynamic";

export default async function OnboardPage() {
  const { brandKit, cadences } = await getWorkspaceContext();

  return (
    <BrandForm
      brand={{
        niche: brandKit?.niche ?? "",
        audience: brandKit?.audience ?? "",
        tone: brandKit?.tone ?? "",
        rpmCategory: brandKit?.rpmCategory ?? "",
        hookStyle: brandKit?.hookStyle ?? "",
        cta: brandKit?.cta ?? "",
        bannedPhrases: readList(brandKit?.bannedPhrases),
        colors: readList(brandKit?.colors),
      }}
      cadences={Object.fromEntries(
        cadences.map((c) => [c.mode, c.enabled ? c.perWeek : 0]),
      )}
    />
  );
}
