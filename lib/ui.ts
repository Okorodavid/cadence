/** Shared presentation vocabulary. Client-safe — no db, no node imports. */

import type { JobStatus, Mode } from "@/pipelines/types";

export const MODE_META: Record<
  Mode,
  {
    label: string;
    short: string;
    accent: string;
    dot: string;
    blurb: string;
    /** Not yet available to create — shown but disabled in the UI. */
    comingSoon?: boolean;
  }
> = {
  zach_short: {
    label: "3D short",
    short: "3D",
    accent: "text-violet",
    dot: "bg-violet",
    blurb: "40–60s 3D explainer, hook in 2s, hard cut ending",
  },
  ugc_ad: {
    label: "UGC ad",
    short: "UGC",
    accent: "text-hot",
    dot: "bg-hot",
    blurb: "3 vertical clips, same face, product in hand",
  },
  faceless_yt: {
    label: "Faceless YT",
    short: "YT",
    accent: "text-cool",
    dot: "bg-cool",
    blurb: "B-roll + VO, curiosity loop every 45s",
    comingSoon: true,
  },
};

/** Single source of truth: is this mode disabled for new work? */
export function isComingSoon(mode: string): boolean {
  return MODE_META[mode as Mode]?.comingSoon === true;
}

export const STATUS_META: Record<
  JobStatus,
  { label: string; className: string; dot: string }
> = {
  idea: {
    label: "Idea",
    className: "bg-raise2 text-faint",
    dot: "bg-faint",
  },
  scripted: {
    label: "Scripted",
    className: "bg-cool/15 text-cool",
    dot: "bg-cool",
  },
  rendering: {
    label: "Rendering",
    className: "bg-accent/15 text-accent",
    dot: "bg-accent",
  },
  review: {
    label: "Review",
    className: "bg-violet/15 text-violet",
    dot: "bg-violet",
  },
  ready: {
    label: "Ready",
    className: "bg-go/15 text-go",
    dot: "bg-go",
  },
  failed: {
    label: "Failed",
    className: "bg-hot/15 text-hot",
    dot: "bg-hot",
  },
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const WEEKDAYS_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Hand-rolled rather than Intl: server and browser resolve different default
// locales (12h vs 24h, "Sep 21" vs "21 Sep"), which shows up as a React
// hydration mismatch on every date on the page.

export function fmtDay(d: Date): string {
  return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()}`;
}

export function fmtTime(d: Date | null | undefined): string {
  if (!d) return "";
  const h = d.getHours();
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(d.getMinutes()).padStart(2, "0")} ${suffix}`;
}

export function fmtClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(
    2,
    "0",
  )}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function fmtDateLong(d: Date): string {
  return `${WEEKDAYS_LONG[(d.getDay() + 6) % 7]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function secondsLabel(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}
