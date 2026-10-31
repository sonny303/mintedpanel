// NPI Registry (NPPES) lookup — MINT-110. The pure half, shared by the server
// route and the browser: the wire shapes, input validation, the name match,
// and the verification message staff see under an NPI field. No I/O.
//
// The registry is a check, never a gate: a missing record, a name that
// differs, or the registry being down only ever produces a warning. The CMS
// check digit (src/lib/providerIdentity) is the only NPI rule that blocks.
import { isValidNpi, stripNpiSeparators } from "@/lib/providerIdentity";
import { US_STATES } from "@/lib/usStates";

/** The most matches a name search returns; the route asks the registry for one
 * more so it can say the list was cut short. */
export const NPI_REGISTRY_RESULT_CAP = 10;
/** NPPES stores at most 35 characters for a first or last name. */
export const NPI_REGISTRY_NAME_MAX = 35;
export const NPI_REGISTRY_UNAVAILABLE_MESSAGE = "NPI Registry is unavailable";
export const NPI_REGISTRY_QUERY_REJECTED_MESSAGE =
  "The NPI Registry would not run that search — check the name for unusual characters";
export const NPI_REGISTRY_RATE_LIMIT_MESSAGE =
  "Too many NPI Registry lookups — wait a minute and try again";

export type NpiEnumerationType = "NPI-1" | "NPI-2";

export interface NpiRegistryName {
  firstName: string | null;
  lastName: string | null;
}

/** Public registry fields only, exactly as the registry spells them. */
export interface NpiRegistryRecord {
  npi: string;
  /** NPI-1 is an individual, NPI-2 an organization. */
  enumerationType: NpiEnumerationType;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  /** NPI-2 records only. */
  organizationName: string | null;
  credential: string | null;
  primaryTaxonomy: { code: string; description: string | null } | null;
  practiceCity: string | null;
  practiceState: string | null;
  status: "active" | "inactive";
  /** YYYY-MM-DD */
  enumerationDate: string | null;
  /** Former and other names the registry lists for an individual. */
  otherNames: NpiRegistryName[];
}

export interface NpiRegistrySearchInput {
  firstName: string;
  lastName: string;
  /** Two-letter code; omitted or "" searches every state. */
  state?: string | null;
}

export interface NpiRegistrySearchResult {
  results: NpiRegistryRecord[];
  /** The registry had more matches than NPI_REGISTRY_RESULT_CAP. */
  truncated: boolean;
}

export interface NpiRegistryLookupResult {
  /** null when the registry has no record for the NPI. */
  record: NpiRegistryRecord | null;
}

export interface ValidNpiRegistrySearch {
  firstName: string;
  lastName: string;
  state: string | null;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const STATE_SET: ReadonlySet<string> = new Set(US_STATES);

// Letters NFD cannot split into a base letter plus an accent, spelled the way
// NPPES stores them (plain uppercase ASCII).
const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  ß: "ss",
  ẞ: "SS",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "TH",
  ħ: "h",
  Ħ: "H",
  ı: "i",
  ŀ: "l",
  Ŀ: "L",
  ŋ: "n",
  Ŋ: "N",
  ŧ: "t",
  Ŧ: "T",
  ſ: "s",
};
const TRANSLITERATE_RE = new RegExp(`[${Object.keys(TRANSLITERATIONS).join("")}]`, "gu");
// Curly and look-alike apostrophes typed or pasted into a name.
const APOSTROPHES_RE = /[‘’‛ʼ′`´]/g;
// Generational suffixes and degree initials staff tack onto a name. Only
// trailing words go, and never the last remaining one ("Smith Jr" → "Smith").
const NAME_SUFFIXES: ReadonlySet<string> = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "md",
  "phd",
  "dpt",
  "esq",
]);
// What NPPES accepts once a name is folded: a letter, then letters, spaces,
// apostrophes and hyphens (periods are already gone).
const REGISTRY_NAME_RE = /^[A-Za-z][A-Za-z' -]*$/;

/** A name as the registry spells it: curly apostrophes made straight, letters
 * like "ł", "ø" and "ß" transliterated, accents and periods removed, and a
 * trailing suffix dropped. "José" → "Jose", "Łukasz" → "Lukasz",
 * "Strauß" → "Strauss", "J." → "J", "Smith, Jr." → "Smith". Used for both the
 * registry query and the name match, so the two always agree. */
export function foldNameForRegistry(name: string): string {
  const folded = name
    .replace(APOSTROPHES_RE, "'")
    .replace(TRANSLITERATE_RE, (letter) => TRANSLITERATIONS[letter] ?? letter)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[.,]/g, " ");
  const words = folded.split(/\s+/).filter(Boolean);
  while (words.length > 1 && NAME_SUFFIXES.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  return words.join(" ");
}

function readName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function nameProblem(folded: string): string | null {
  if (!REGISTRY_NAME_RE.test(folded)) {
    const chars = [...folded];
    const bad = /[A-Za-z]/.test(chars[0] ?? "")
      ? (chars.find((char) => !/[A-Za-z' -]/.test(char)) ?? "")
      : (chars[0] ?? "");
    return `The NPI Registry takes Latin letters, spaces, apostrophes, periods and hyphens, starting with a letter — "${bad}" can't be searched`;
  }
  if (folded.length > NPI_REGISTRY_NAME_MAX) {
    return `Names must be ${NPI_REGISTRY_NAME_MAX} characters or fewer`;
  }
  return null;
}

/** The search input the route accepts (and the button enables on): first and
 * last name required, state optional. The value carries the folded names
 * (foldNameForRegistry), which is what goes to the registry. */
export function validateNpiRegistrySearch(input: unknown): Validation<ValidNpiRegistrySearch> {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const record = body as Record<string, unknown>;
  const rawFirst = readName(record.firstName);
  const rawLast = readName(record.lastName);
  if (!rawFirst || !rawLast) {
    return { ok: false, error: "Enter a first and last name to search the NPI Registry" };
  }
  const firstName = foldNameForRegistry(rawFirst);
  const lastName = foldNameForRegistry(rawLast);
  const problem = nameProblem(firstName) ?? nameProblem(lastName);
  if (problem) return { ok: false, error: problem };
  const rawState = record.state;
  if (rawState !== undefined && rawState !== null && typeof rawState !== "string") {
    return { ok: false, error: "Choose a two-letter US state" };
  }
  const state = (rawState ?? "").trim().toUpperCase();
  if (state && !STATE_SET.has(state)) return { ok: false, error: "Choose a two-letter US state" };
  return { ok: true, value: { firstName, lastName, state: state || null } };
}

/** The by-number input: an NPI (dashes and spaces allowed) that passes the CMS
 * check digit. A number that fails it is never sent to the registry. */
export function validateNpiRegistryLookup(input: unknown): Validation<string> {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const raw = (body as Record<string, unknown>).npi;
  const npi = typeof raw === "string" ? stripNpiSeparators(raw) : "";
  if (!isValidNpi(npi))
    return { ok: false, error: "Enter a 10-digit NPI with a valid check digit" };
  return { ok: true, value: npi };
}

// Case, spaces and punctuation ignored on top of the registry fold:
// "O'Brien" = "OBRIEN", "Smith-Jones" = "SMITH JONES", "Łukasz" = "LUKASZ".
function matchKey(value: string | null | undefined): string {
  return foldNameForRegistry(value ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export type NpiNameMatch = "match" | "mismatch" | "unchecked";

/** Whether the names staff typed match the registry record. Last names must be
 * equal. The typed first name must be the start of the registry's — an
 * initial or short form ("J" or "Chris" against CHRISTOPHER) — or of its first
 * and middle names together ("Mary Ann" against MARY ANN); a registry initial
 * matches any first name with that letter. A longer typed name never matches
 * a shorter registry one ("Danielle" is not DANIEL). The registry's former and
 * other names count too. "unchecked" until staff have typed both names. */
export function compareNpiRegistryName(
  typed: { firstName: string; lastName: string },
  record: NpiRegistryRecord,
): NpiNameMatch {
  const first = matchKey(typed.firstName);
  const last = matchKey(typed.lastName);
  if (!first || !last) return "unchecked";
  const names = [
    { firstName: record.firstName, middleName: record.middleName, lastName: record.lastName },
    ...record.otherNames.map((name) => ({ ...name, middleName: null })),
  ];
  const matches = names.some((name) => {
    const registryFirst = matchKey(name.firstName);
    if (!registryFirst || matchKey(name.lastName) !== last) return false;
    if (registryFirst.startsWith(first)) return true;
    if (registryFirst.length === 1) return first.startsWith(registryFirst);
    return `${registryFirst}${matchKey(name.middleName)}`.startsWith(first);
  });
  return matches ? "match" : "mismatch";
}

/** "JANE A DOE" for an individual, the organization name for an NPI-2. */
export function registryDisplayName(record: NpiRegistryRecord): string {
  if (record.enumerationType === "NPI-2") return record.organizationName ?? "Organization";
  return [record.firstName, record.middleName, record.lastName].filter(Boolean).join(" ");
}

/** "JANE A DOE, PT · Physical Therapist · DENVER, CO", skipping empty parts. */
export function registrySummary(record: NpiRegistryRecord): string {
  const name = registryDisplayName(record);
  const who = record.credential ? `${name}, ${record.credential}` : name;
  const place = [record.practiceCity, record.practiceState].filter(Boolean).join(", ");
  return [who, record.primaryTaxonomy?.description ?? null, place || null]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** What the NPI field's registry check is doing, as the form's hook sees it. */
export type NpiLookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; record: NpiRegistryRecord | null };

export interface NpiVerificationView {
  tone: "neutral" | "ok" | "warn";
  title: string;
  detail: string | null;
}

const STILL_SAVEABLE = "You can still save this provider.";

/** The line shown under an NPI field. Every outcome leaves the form saveable;
 * null means there is nothing to say (no checkable NPI yet). */
export function npiVerificationView(
  state: NpiLookupState,
  typed: { firstName: string; lastName: string },
): NpiVerificationView | null {
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return { tone: "neutral", title: "Checking the NPI Registry…", detail: null };
  }
  if (state.status === "error") {
    return { tone: "warn", title: state.message, detail: STILL_SAVEABLE };
  }
  const record = state.record;
  if (!record) {
    return {
      tone: "warn",
      title: "Not found in the NPI Registry",
      detail: `Re-check the number; deactivated NPIs are not listed. ${STILL_SAVEABLE}`,
    };
  }
  if (record.enumerationType === "NPI-2") {
    return {
      tone: "warn",
      title: "This NPI belongs to an organization",
      detail: `The registry lists ${registryDisplayName(record)}. A provider's Type 1 NPI is an individual's.`,
    };
  }
  if (record.status !== "active") {
    return {
      tone: "warn",
      title: "The NPI Registry lists this NPI as inactive",
      detail: registrySummary(record),
    };
  }
  if (compareNpiRegistryName(typed, record) === "mismatch") {
    return {
      tone: "warn",
      title: "Found in the NPI Registry, but the name differs",
      detail: `The registry lists ${registrySummary(record)}.`,
    };
  }
  return { tone: "ok", title: "Found in the NPI Registry", detail: registrySummary(record) };
}

/** What the name search is doing, as the form's hook sees it. */
export type NpiSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; result: NpiRegistrySearchResult };

/** What the search status line announces. */
export function npiSearchStatusText(state: NpiSearchState): string {
  if (state.status === "idle") return "";
  if (state.status === "loading") return "Searching the NPI Registry…";
  if (state.status === "error") return `${state.message}. You can still type the NPI.`;
  const count = state.result.results.length;
  if (count === 0) return "No individuals in the NPI Registry match that name.";
  const matches = `${count} ${count === 1 ? "match" : "matches"} in the NPI Registry`;
  return state.result.truncated
    ? `${matches} — showing the first ${NPI_REGISTRY_RESULT_CAP}. Add a state to narrow it.`
    : `${matches}. Pick one to fill the NPI.`;
}
