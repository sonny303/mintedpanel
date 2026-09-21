// Provider-import facility locator. `facility_name` stays the column: an exact
// facility name wins, and a street address is accepted only when it resolves
// to one facility in the org. A shared street+ZIP is not a guess — the suite
// unit in the gap after the street has to pick exactly one, or the row errors.

export interface FacilityLocatorRecord {
  id: string;
  name: string;
  street?: string | null;
  suite?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export type FacilityLocatorResult =
  | { status: "empty" }
  | { status: "matched"; facilityId: string }
  | { status: "none"; reason: string }
  | { status: "ambiguous"; reason: string };

export const FACILITY_UNKNOWN_REASON =
  "Unknown facility — use the exact name from the reference sheet, or the location's street address";

export const FACILITY_AMBIGUOUS_REASON =
  "Ambiguous facility — this address matches more than one location; use the exact name from the reference sheet";

const FACILITY_AMBIGUOUS_NAME_REASON =
  "Ambiguous facility — more than one location has this name; use the street address";

const SUFFIX: Record<string, string> = {
  st: "street",
  rd: "road",
  dr: "drive",
  ave: "avenue",
  blvd: "boulevard",
  ln: "lane",
  ct: "court",
  hwy: "highway",
  pkwy: "parkway",
  cir: "circle",
  pl: "place",
  ter: "terrace",
  trl: "trail",
};

const SUITE_WORDS = new Set(["suite", "ste", "unit", "apt", "apartment"]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/#/g, " ")
    .replace(/[.]/g, "")
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const zip = token.match(/^(\d{5})(?:-\d{4})?$/);
      if (zip) return zip[1];
      return SUFFIX[token] ?? token;
    });
}

function zip5(value: string | null | undefined): string | null {
  const match = (value ?? "").match(/\d{5}/);
  return match ? match[0] : null;
}

/** Trailing ZIP5 in a free-text address cell (ZIP+4 counts). First-match
 * would treat a 5-digit street number as the ZIP and corrupt suite gaps. */
function trailingZip5(value: string): string | null {
  const matches = [...value.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

function suiteUnit(suite: string | null | undefined): string | null {
  if (!suite) return null;
  const parts = tokens(suite).filter((token) => !SUITE_WORDS.has(token));
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

function phraseStarts(hay: readonly string[], phrase: readonly string[]): number[] {
  const starts: number[] = [];
  for (let i = 0; i + phrase.length <= hay.length; i++) {
    let matches = true;
    for (let j = 0; j < phrase.length; j++) {
      if (hay[i + j] !== phrase[j]) {
        matches = false;
        break;
      }
    }
    if (matches) starts.push(i);
  }
  return starts;
}

function cityFollows(hay: readonly string[], index: number, city: readonly string[]): boolean {
  if (city.length === 0 || index + city.length > hay.length) return false;
  return city.every((token, offset) => hay[index + offset] === token);
}

function boundaryOk(
  hay: readonly string[],
  end: number,
  facility: FacilityLocatorRecord,
  zip: string,
): boolean {
  if (end >= hay.length) return true;
  const next = hay[end];
  const state = (facility.state ?? "").trim().toLowerCase();
  if (state && next === state) return true;
  if (next === zip) return true;
  if (SUITE_WORDS.has(next)) return true;
  const unit = suiteUnit(facility.suite);
  if (unit && next === unit) return true;
  return cityFollows(hay, end, tokens(facility.city ?? ""));
}

/** Tokens between the street phrase and the city, state, or ZIP. */
function gapUnit(
  hay: readonly string[],
  end: number,
  facility: FacilityLocatorRecord,
  zip: string,
): string | null {
  const city = tokens(facility.city ?? "");
  const state = (facility.state ?? "").trim().toLowerCase();
  const gap: string[] = [];
  for (let i = end; i < hay.length; i++) {
    const token = hay[i];
    if (token === zip) break;
    if (state && token === state) break;
    if (cityFollows(hay, i, city)) break;
    gap.push(token);
  }
  const units = gap.filter((token) => !SUITE_WORDS.has(token));
  return units.length === 1 ? units[0] : null;
}

interface StreetHit {
  facility: FacilityLocatorRecord;
  end: number;
}

function streetHits(cell: string, facilities: readonly FacilityLocatorRecord[]): StreetHit[] {
  const zip = trailingZip5(cell);
  if (!zip) return [];
  const hay = tokens(cell);
  const hits: StreetHit[] = [];
  for (const facility of facilities) {
    if (zip5(facility.zip) !== zip) continue;
    const street = tokens(facility.street ?? "");
    if (street.length === 0) continue;
    const start = phraseStarts(hay, street).find((index) =>
      boundaryOk(hay, index + street.length, facility, zip),
    );
    if (start === undefined) continue;
    hits.push({ facility, end: start + street.length });
  }
  return hits;
}

export function matchFacilityLocator(
  cell: string | null | undefined,
  facilities: readonly FacilityLocatorRecord[],
): FacilityLocatorResult {
  const text = (cell ?? "").trim();
  if (!text) return { status: "empty" };

  const nameKey = text.toLowerCase();
  const byName = facilities.filter((facility) => facility.name.trim().toLowerCase() === nameKey);
  if (byName.length === 1) return { status: "matched", facilityId: byName[0].id };
  if (byName.length > 1) return { status: "ambiguous", reason: FACILITY_AMBIGUOUS_NAME_REASON };

  const hits = streetHits(text, facilities);
  if (hits.length === 1) return { status: "matched", facilityId: hits[0].facility.id };
  if (hits.length > 1) {
    const zip = trailingZip5(text);
    const narrowed =
      zip === null
        ? []
        : hits.filter((hit) => {
            const unit = suiteUnit(hit.facility.suite);
            return unit !== null && gapUnit(tokens(text), hit.end, hit.facility, zip) === unit;
          });
    if (narrowed.length === 1) return { status: "matched", facilityId: narrowed[0].facility.id };
    return { status: "ambiguous", reason: FACILITY_AMBIGUOUS_REASON };
  }
  return { status: "none", reason: FACILITY_UNKNOWN_REASON };
}
