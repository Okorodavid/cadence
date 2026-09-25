"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "./avatar";
import { VoiceBuilder } from "./voice-builder";
import type { VoiceSettings } from "@/lib/voice-presets";

type CharacterView = {
  id: string;
  name: string;
  soulId: string | null;
  avatarUrl: string | null;
  styleNotes: string;
  voiceId: string | null;
  voiceSettings: VoiceSettings;
  lookbook: string[];
  sourceImages: string[];
};

export function CharacterStudio({
  character,
  clipCount,
}: {
  character: CharacterView | null;
  clipCount: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState(character?.name ?? "");
  const [styleNotes, setStyleNotes] = useState(character?.styleNotes ?? "");
  const [photos, setPhotos] = useState<string[]>(character?.sourceImages ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(character?.avatarUrl ?? null);

  // The avatar is display-only: it identifies the character across the app
  // but is never sent to Higgsfield as a training or reference image.
  async function changeAvatar(files: FileList | null) {
    const file = files?.[0];
    if (!file || !character) return;
    setBusy("avatar");
    setNote("");
    try {
      const form = new FormData();
      form.append("files", file);
      form.append("folder", "characters/avatar");
      const up = await fetch("/api/upload", { method: "POST", body: form });
      const data = await up.json();
      if (!up.ok || !data.urls?.[0]) throw new Error(data.rejected?.[0] ?? data.error ?? "Upload failed");
      const res = await fetch("/api/character", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: character.id, avatarUrl: data.urls[0] }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setAvatarUrl(data.urls[0]);
      startTransition(() => router.refresh());
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
      if (avatarRef.current) avatarRef.current.value = "";
    }
  }

  async function saveCharacter() {
    if (!name.trim()) {
      setNote("Give the character a name first.");
      return;
    }
    setBusy("save");
    setNote("");
    try {
      const res = await fetch("/api/character", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: character?.id,
          name,
          styleNotes,
          sourceImageUrls: photos,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setNote("Saved.");
      startTransition(() => router.refresh());
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy("upload");
    setNote("");
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      form.append("folder", "characters/source");
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setPhotos((p) => [...p, ...(data.urls as string[])]);
      if (data.rejected?.length) setNote(`Skipped: ${data.rejected.join("; ")}`);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function trainLookbook() {
    setBusy("lookbook");
    setNote("Generating the look book — this calls Higgsfield six times.");
    try {
      const res = await fetch("/api/character/lookbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: character?.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Look book failed");
      setNote(
        data.usedFallback
          ? "Look book built. Soul ID training was unavailable, so these stills are the face lock."
          : `Look book built from Soul ID ${data.soulId}.`,
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const enoughPhotos = photos.length >= 8;

  return (
    <div className="py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Character</h1>
          <p className="mt-1 text-sm text-muted">
            Train the identity once. Every UGC clip after that reuses the same face.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={saveCharacter} disabled={!!busy} className="btn">
            {busy === "save" ? "Saving…" : character ? "Save" : "Create character"}
          </button>
          <button
            onClick={trainLookbook}
            disabled={!!busy || !character}
            className="btn btn-primary"
            title={character ? "" : "Create the character first"}
          >
            {busy === "lookbook"
              ? "Generating…"
              : character?.lookbook.length
                ? "Rebuild look book"
                : "Build look book"}
          </button>
        </div>
      </div>

      {note && (
        <p className="mb-5 rounded-lg border border-line bg-raise px-3 py-2 text-xs text-muted">
          {note}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          {character && (
            <div className="card flex items-center gap-4 p-4">
              <Avatar src={avatarUrl} name={name || character.name} size={72} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">{name || character.name}</p>
                <p className="mt-0.5 text-[11px] text-faint">Profile photo · display only</p>
                <button
                  onClick={() => avatarRef.current?.click()}
                  disabled={!!busy}
                  className="btn btn-sm mt-2"
                >
                  {busy === "avatar" ? "Uploading…" : avatarUrl ? "Change photo" : "Add photo"}
                </button>
                <input
                  ref={avatarRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => changeAvatar(e.target.files)}
                />
              </div>
            </div>
          )}
          <div className="card p-4">
            <label className="label" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mara"
            />

            <label className="label mt-4" htmlFor="style">
              Appearance lock
            </label>
            <textarea
              id="style"
              className="input resize-none text-[13px] leading-relaxed"
              rows={5}
              value={styleNotes}
              onChange={(e) => setStyleNotes(e.target.value)}
              placeholder="a fictional 29 year old person of average build with dark shoulder-length hair, wearing a plain charcoal crewneck, friendly relaxed expression"
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
              This exact line is prepended to every look book prompt. Leave it blank and
              Cadence derives a stable fictional identity from the character id.
            </p>

            <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[11px]">
              <span className="text-faint">Soul ID</span>
              <span className="font-mono text-muted">
                {character?.soulId ?? "look book fallback"}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-faint">Clips using this face</span>
              <span className="text-muted">{clipCount}</span>
            </div>
          </div>

          {character && (
            <VoiceBuilder
              characterId={character.id}
              initialVoiceId={character.voiceId}
              initialSettings={character.voiceSettings}
            />
          )}

          <div className="card p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="panel-title">Training photos</h2>
              <span className={`text-[11px] ${enoughPhotos ? "text-go" : "text-faint"}`}>
                {photos.length}/8 minimum
              </span>
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-faint">
              Upload 8–20 photos of a person whose likeness you own the rights to. Varied
              angles and lighting, one person per photo.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => upload(e.target.files)}
              className="block w-full text-[11px] text-muted file:mr-3 file:rounded-md file:border-0 file:bg-raise2 file:px-3 file:py-1.5 file:text-[11px] file:text-fg hover:file:bg-line"
            />

            {photos.length > 0 && (
              <div className="mt-3 grid grid-cols-5 gap-1.5">
                {photos.map((url) => (
                  <div key={url} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      className="aspect-square w-full rounded object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotos((p) => p.filter((u) => u !== url))}
                      title="Remove photo"
                      aria-label="Remove photo"
                      className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-ink text-[11px] leading-none text-muted opacity-0 transition group-hover:opacity-100 hover:bg-hot hover:text-white focus:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {photos.length > 0 && (
              <p className="mt-2 text-[11px] text-faint">
                Hover a photo to remove it. Changes save when you press Save.
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="panel-title">Look book</h2>
            <span className="text-[11px] text-faint">
              {character?.lookbook.length
                ? `${character.lookbook.length} locked references`
                : "not generated yet"}
            </span>
          </div>

          {character?.lookbook.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {character.lookbook.map((url, i) => (
                <figure
                  key={url}
                  className="overflow-hidden rounded-xl border border-line bg-surface"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="aspect-[9/16] w-full object-cover" />
                  <figcaption className="px-2.5 py-1.5 text-[10px] tracking-wider text-faint uppercase">
                    ref {i + 1}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div className="card grid min-h-[320px] place-items-center p-10 text-center">
              <div className="max-w-sm">
                <p className="text-sm text-muted">
                  No look book yet. These six stills become the face reference passed into
                  every Seedance clip — generate them once and the identity stops drifting.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
