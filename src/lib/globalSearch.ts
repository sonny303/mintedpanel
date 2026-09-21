// Pure rules for the cross-org provider lookup (global provider search spike).
//
// Everything here is a pure function over a passed-in term or row set: the term
// sanitizer, the PostgREST filter builder, the row projection, the authorized-
// org narrowing, and the ranking. The service (src/services/globalProviderSearch.ts)
// owns the single Supabase read and nothing else.
//
// PHI posture: this lookup answers "what is this provider's NPI, and which of
// my orgs are they in" — name, credentials, NPI, status, org. An NPI is a
// public NPPES identifier, so the projection carries no PHI. date_of_birth,
// ssn_last4, the home-address columns, phone, email and dea_number are NOT in
// the projection and must never be added to it; FORBIDDEN_SEARCH_COLUMNS below
// is asserted against the select string in the service test.

export const MIN_SEARCH_LENGTH = 2;

/** Rows rendered in the palette. Small on purpose — a lookup, not a browser. */
export const MAX_GLOBAL_SEARCH_RESULTS = 8;

/** Rows fetched before ranking. The DB cannot rank the way rankProviderHits
 *  does (prefix-before-substring across two name columns), so fetch a bounded
 *  superset and rank in memory. Bounded so a two-character term can never pull
 *  an unbounded cross-org scan into the browser. */
export const GLOBAL_SEARCH_FETCH_LIMIT = 60;

/** The one select string the cross-org read is allowed to use. */
export const GLOBAL_PROVIDER_SEARCH_COLUMNS =
  "id, org_id, first_name, last_name, credentials, npi, status, organizations(name)";

/** Columns that must never appear in the projection above. */
export const FORBIDDEN_SEARCH_COLUMNS = [
  "date_of_birth",
  "ssn_last4",
  "home_street",
  "home_city",
  "home_zip",
  "phone",
  "email",
  "dea_number",
] as const;

export interface GlobalProviderHit {
  providerId: string;
  orgId: string;
  orgName: string;
  name: string;
  firstName: string;
  lastName: string;
  credentials: string | null;
  npi: string | null;
  status: string;
}

// PostgREST parses `or=(...)` on commas, parentheses and dots, treats `"` as a
// value quote and `\` as its escape, and passes `%`/`_`/`*` through to ILIKE as
// wildcards. A raw term carrying any of those either breaks the filter or
// silently widens it, so they are stripped rather than escaped — a credentialing
// name has no legitimate use for them, and stripping cannot produce a filter
// that matches more than the user typed.
const STRUCTURAL_CHARS = /[,().:"'\\%_*[\]{}<>=!]/g;
const MAX_TERM_LENGTH = 60;

export function sanitizeSearchTerm(raw: string): string {
  return raw
    .toLowerCase()
    .replace(STRUCTURAL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERM_LENGTH)
    .trim();
}

/** The digits of a term that is asking for an NPI, or null when it is not.
 *  NPIs are 10 digits; a partial one is still worth a prefix match, but two
 *  digits is noise. Hyphens and spaces inside the number are ignored. */
export function npiQueryDigits(sanitized: string): string | null {
  const digits = sanitized.replace(/[\s-]/g, "");
  return /^\d{3,10}$/.test(digits) ? digits : null;
}

export function searchTokens(sanitized: string): string[] {
  return sanitized.split(" ").filter(Boolean);
}

/** The PostgREST `or` filter for a sanitized term, or null when the term is
 *  too short to search. Name terms match either name column; a two-token term
 *  ("jane smith") additionally matches in both orders, because coordinators
 *  type "last first" about as often as "first last". */
export function buildProviderSearchFilter(sanitized: string): string | null {
  if (sanitized.length < MIN_SEARCH_LENGTH) return null;

  const digits = npiQueryDigits(sanitized);
  if (digits) return `npi.ilike.${digits}%`;

  const tokens = searchTokens(sanitized);
  const clauses = [
    `first_name.ilike.%${sanitized}%`,
    `last_name.ilike.%${sanitized}%`,
    `npi.ilike.%${sanitized}%`,
  ];
  if (tokens.length >= 2) {
    const [a, b] = tokens;
    clauses.push(
      `and(first_name.ilike.%${a}%,last_name.ilike.%${b}%)`,
      `and(first_name.ilike.%${b}%,last_name.ilike.%${a}%)`,
    );
  }
  return clauses.join(",");
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  const s = text(value).trim();
  return s.length > 0 ? s : null;
}

/** Project raw rows onto the hit shape. Rows missing an id or an org_id are
 *  dropped rather than rendered with a blank identity — a result the caller
 *  cannot attribute to an org is a result it cannot safely show. */
export function mapProviderSearchRows(rows: readonly unknown[]): GlobalProviderHit[] {
  const hits: GlobalProviderHit[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const providerId = text(row.id);
    const orgId = text(row.org_id);
    if (!providerId || !orgId) continue;
    const firstName = text(row.first_name).trim();
    const lastName = text(row.last_name).trim();
    const embedded = row.organizations as { name?: unknown } | null | undefined;
    hits.push({
      providerId,
      orgId,
      orgName: nullableText(embedded?.name) ?? "",
      name: `${firstName} ${lastName}`.trim(),
      firstName,
      lastName,
      credentials: nullableText(row.credentials),
      npi: nullableText(row.npi),
      status: text(row.status) || "unknown",
    });
  }
  return hits;
}

/** Defense in depth, not the wall. RLS (`providers_select`: org_id IN
 *  user_org_ids()) is what makes a foreign org's provider unreachable. This
 *  drops anything outside the caller's known membership set anyway, so a
 *  policy regression surfaces as a missing row instead of a leaked one, and
 *  the org name comes from the caller's own membership list. */
export function restrictToAuthorizedOrgs(
  hits: readonly GlobalProviderHit[],
  authorizedOrgNames: ReadonlyMap<string, string>,
): GlobalProviderHit[] {
  const kept: GlobalProviderHit[] = [];
  for (const hit of hits) {
    const orgName = authorizedOrgNames.get(hit.orgId);
    if (orgName === undefined) continue;
    kept.push({ ...hit, orgName: orgName || hit.orgName });
  }
  return kept;
}

// Lower is better. An exact NPI beats everything; after that a name the term
// starts is worth more than a name the term merely appears inside.
const SCORE_NPI_EXACT = 0;
const SCORE_LAST_NAME_PREFIX = 1;
const SCORE_FIRST_NAME_PREFIX = 2;
const SCORE_NPI_PREFIX = 3;
const SCORE_SUBSTRING = 4;

function scoreHit(hit: GlobalProviderHit, sanitized: string): number {
  const digits = npiQueryDigits(sanitized);
  const npi = (hit.npi ?? "").toLowerCase();
  if (digits) {
    if (npi === digits) return SCORE_NPI_EXACT;
    return npi.startsWith(digits) ? SCORE_NPI_PREFIX : SCORE_SUBSTRING;
  }
  const [first] = searchTokens(sanitized);
  const head = first ?? sanitized;
  const lastName = hit.lastName.toLowerCase();
  const firstName = hit.firstName.toLowerCase();
  if (lastName.startsWith(head)) return SCORE_LAST_NAME_PREFIX;
  if (firstName.startsWith(head)) return SCORE_FIRST_NAME_PREFIX;
  return SCORE_SUBSTRING;
}

/** Rank and cap. Terminated providers sort below everyone else but are never
 *  dropped — "which org was Dr. Reyes at before they left" is exactly the
 *  question this lookup exists to answer. Ties break deterministically on
 *  last name, first name, org name, then id, so the top row never jitters
 *  between renders of the same result set. */
export function rankProviderHits(
  hits: readonly GlobalProviderHit[],
  sanitized: string,
  limit: number = MAX_GLOBAL_SEARCH_RESULTS,
): GlobalProviderHit[] {
  return [...hits]
    .map((hit) => ({ hit, score: scoreHit(hit, sanitized) }))
    .sort((a, b) => {
      const aTerminated = a.hit.status === "terminated" ? 1 : 0;
      const bTerminated = b.hit.status === "terminated" ? 1 : 0;
      return (
        aTerminated - bTerminated ||
        a.score - b.score ||
        a.hit.lastName.localeCompare(b.hit.lastName) ||
        a.hit.firstName.localeCompare(b.hit.firstName) ||
        a.hit.orgName.localeCompare(b.hit.orgName) ||
        a.hit.providerId.localeCompare(b.hit.providerId)
      );
    })
    .slice(0, Math.max(limit, 0))
    .map((entry) => entry.hit);
}
