"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "./avatar";

const LINKS = [
  { href: "/calendar", label: "Calendar" },
  { href: "/ideas", label: "Ideas" },
  { href: "/character", label: "Character" },
  { href: "/assets", label: "Assets" },
  { href: "/onboard", label: "Brand" },
  { href: "/export", label: "Export" },
];

type Providers = { higgsfield: string; scripts: string; voice: string };
type CharacterChip = { name: string; avatarUrl: string | null };

export function Nav() {
  const pathname = usePathname();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [character, setCharacter] = useState<CharacterChip | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => {
        setProviders(d.providers);
        setCharacter(d.character ?? null);
      })
      .catch(() => {});
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-6 px-4 sm:px-6">
        <Link href="/calendar" className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-[13px] font-black text-black">
            C
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Cadence</span>
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-raise text-fg"
                    : "text-muted hover:bg-raise hover:text-fg"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 text-[11px]">
          {providers && (
            <>
              <ProviderPill
                label="Higgsfield"
                value={providers.higgsfield}
                live={providers.higgsfield === "live"}
              />
              <ProviderPill
                label="Scripts"
                value={providers.scripts}
                live={providers.scripts === "claude"}
              />
              <ProviderPill
                label="Voice"
                value={providers.voice}
                live={providers.voice !== "silent"}
              />
            </>
          )}
          {character && (
            <Link
              href="/character"
              className="ml-1 flex items-center gap-2 rounded-full border border-line bg-surface py-0.5 pr-3 pl-0.5 transition hover:bg-raise"
              title="Active character"
            >
              <Avatar src={character.avatarUrl} name={character.name} size={26} />
              <span className="text-[12px] font-medium text-fg">{character.name}</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function ProviderPill({
  label,
  value,
  live,
}: {
  label: string;
  value: string;
  live: boolean;
}) {
  return (
    <span
      className="hidden items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 md:inline-flex"
      title={`${label}: ${value}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${live ? "bg-go" : "bg-faint"}`}
        aria-hidden
      />
      <span className="text-faint">{label}</span>
      <span className="font-medium text-muted">{value}</span>
    </span>
  );
}
