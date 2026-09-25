import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addJobToArchive, slugify, streamZip } from "@/lib/export";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const job = await db.calendarJob.findUnique({
    where: { id },
    include: { scenes: { orderBy: { order: "asc" } } },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const name = `${slugify(job.title || job.topic)}.zip`;
  const stream = streamZip(async (archive) => {
    await addJobToArchive(archive, job);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
