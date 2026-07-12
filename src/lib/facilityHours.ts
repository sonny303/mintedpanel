// Facility hours — the LOCKED per-day jsonb contract (PM 2026-07-10, E1.2
// TE-3). Stored shape in facilities.hours:
//   { "mon": { "status": "open", "open": "07:00", "close": "19:00" },
//     ..., "sun": { "status": "closed" } }
// with open/close present ONLY when status = "open"; times are 24h "HH:MM"
// strings; single range per day (no split shifts in v1). This module is the
// SINGLE source of truth for encode/decode, the weekday quick-fill, 12h
// display formatting, and validation — it is also the extension fill
// contract ({{facility.hours.mon.open}}-style tokens later), so no hours
// logic may live inline in components.

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** One stored day: open/close only when open. */
export type DayHours = { status: "open"; open: string; close: string } | { status: "closed" };

/** The stored jsonb shape (days may be absent = not yet entered). */
export type FacilityHours = Partial<Record<DayKey, DayHours>>;

/** Editor model: every day present; times kept even while closed so toggling
 * Open/Closed doesn't lose what was typed. */
export interface DayHoursDraft {
  open: boolean;
  openTime: string;
  closeTime: string;
}
export type HoursDraft = Record<DayKey, DayHoursDraft>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(value: string): boolean {
  return HHMM.test(value);
}

export const EMPTY_DAY_DRAFT: DayHoursDraft = { open: false, openTime: "", closeTime: "" };

export function emptyHoursDraft(): HoursDraft {
  return {
    mon: { ...EMPTY_DAY_DRAFT },
    tue: { ...EMPTY_DAY_DRAFT },
    wed: { ...EMPTY_DAY_DRAFT },
    thu: { ...EMPTY_DAY_DRAFT },
    fri: { ...EMPTY_DAY_DRAFT },
    sat: { ...EMPTY_DAY_DRAFT },
    sun: { ...EMPTY_DAY_DRAFT },
  };
}

/** Stored jsonb → editor model. Unknown/malformed day entries decode closed. */
export function decodeHours(stored: unknown): HoursDraft {
  const draft = emptyHoursDraft();
  if (!stored || typeof stored !== "object") return draft;
  for (const day of DAY_KEYS) {
    const raw = (stored as Record<string, unknown>)[day];
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { status?: unknown; open?: unknown; close?: unknown };
    if (
      entry.status === "open" &&
      typeof entry.open === "string" &&
      typeof entry.close === "string"
    ) {
      draft[day] = { open: true, openTime: entry.open, closeTime: entry.close };
    }
  }
  return draft;
}

/** Editor model → the locked stored shape. Call validateHoursDraft first. */
export function encodeHours(draft: HoursDraft): FacilityHours {
  const out: FacilityHours = {};
  for (const day of DAY_KEYS) {
    const d = draft[day];
    out[day] = d.open
      ? { status: "open", open: d.openTime, close: d.closeTime }
      : { status: "closed" };
  }
  return out;
}

/** The weekday quick-fill: one range → Mon–Fri open, Sat/Sun closed. Days
 * remain individually editable afterward (pure — returns a new draft). */
export function applyWeekdayDefault(openTime: string, closeTime: string): HoursDraft {
  const weekday: DayHoursDraft = { open: true, openTime, closeTime };
  return {
    mon: { ...weekday },
    tue: { ...weekday },
    wed: { ...weekday },
    thu: { ...weekday },
    fri: { ...weekday },
    sat: { ...EMPTY_DAY_DRAFT },
    sun: { ...EMPTY_DAY_DRAFT },
  };
}

/** Per-day validation messages, keyed by day. Empty object = valid. */
export function validateHoursDraft(draft: HoursDraft): Partial<Record<DayKey, string>> {
  const errors: Partial<Record<DayKey, string>> = {};
  for (const day of DAY_KEYS) {
    const d = draft[day];
    if (!d.open) continue;
    if (!isValidTime(d.openTime) || !isValidTime(d.closeTime)) {
      errors[day] = "Enter opening and closing times";
    } else if (d.closeTime <= d.openTime) {
      errors[day] = "Closing time must be after opening time";
    }
  }
  return errors;
}

/** 24h "HH:MM" → 12h display ("7:00 AM"). Invalid input renders as typed. */
export function formatTime12h(time: string): string {
  if (!isValidTime(time)) return time;
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Compact list-row summary, e.g. "Mon–Fri 7:00 AM–7:00 PM · Sat, Sun closed"
 * collapses when all open days share one range; otherwise counts open days.
 * Returns null when no day is marked open (hours not entered yet). */
export function hoursSummary(stored: unknown): string | null {
  const draft = decodeHours(stored);
  const openDays = DAY_KEYS.filter((d) => draft[d].open);
  if (openDays.length === 0) return null;
  const ranges = new Set(openDays.map((d) => `${draft[d].openTime}–${draft[d].closeTime}`));
  const weekdaySet = ["mon", "tue", "wed", "thu", "fri"].join(",");
  if (ranges.size === 1) {
    const [range] = [...ranges];
    const [open, close] = range.split("–");
    const label =
      openDays.join(",") === weekdaySet
        ? "Mon–Fri"
        : openDays.map((d) => DAY_LABELS[d].slice(0, 3)).join(", ");
    return `${label} ${formatTime12h(open)}–${formatTime12h(close)}`;
  }
  return `Open ${openDays.length} days/week`;
}
