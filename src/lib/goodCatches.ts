// Weekly "good catch" counter — corrections are celebrated, never penalized.
// A good catch is a human overruling a wrong guess (a dictionary "No", a
// training Edit that overrides a suggestion). Client-local for v1 (per org+user,
// resets each ISO week); no server table. Never surfaced as a target or streak.
const PREFIX = "mp-good-catches";

interface Stored {
  weekStart: string;
  count: number;
}

// Monday 00:00 of the given date's ISO week, as a YYYY-MM-DD key.
function isoWeekStart(now: Date): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function key(orgId: string, userId: string): string {
  return `${PREFIX}:${orgId}:${userId}`;
}

function read(orgId: string, userId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(key(orgId, userId));
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as Stored;
    if (parsed.weekStart !== isoWeekStart(new Date())) return 0;
    return typeof parsed.count === "number" ? parsed.count : 0;
  } catch {
    return 0;
  }
}

export function getGoodCatches(orgId: string, userId: string): number {
  return read(orgId, userId);
}

export function bumpGoodCatches(orgId: string, userId: string, by = 1): number {
  if (typeof window === "undefined") return 0;
  const next = read(orgId, userId) + by;
  try {
    const value: Stored = { weekStart: isoWeekStart(new Date()), count: next };
    window.localStorage.setItem(key(orgId, userId), JSON.stringify(value));
  } catch {
    // storage disabled — the counter is best-effort, not load-bearing.
  }
  return next;
}
