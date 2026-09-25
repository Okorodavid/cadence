import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { saveBuffer } from "@/lib/storage";

export const runtime = "nodejs";

const ALLOWED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_BYTES = 12 * 1024 * 1024;

/** Character photos and product shots. Stored locally, served from /media. */
export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const folder = (form.get("folder") as string) || "uploads";

  if (!files.length) {
    return NextResponse.json({ error: "No files" }, { status: 400 });
  }

  const urls: string[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    if (!ALLOWED.includes(file.type)) {
      rejected.push(`${file.name}: ${file.type || "unknown type"}`);
      continue;
    }
    if (file.size > MAX_BYTES) {
      rejected.push(`${file.name}: over 12MB`);
      continue;
    }
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const name = `${crypto.randomUUID()}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    urls.push(await saveBuffer(`${folder.replace(/[^a-z0-9/-]/gi, "")}/${name}`, buf));
  }

  return NextResponse.json({ urls, rejected });
}
