// NPI Registry (NPPES) client — MINT-110. Server-only: the registry API sends
// no CORS headers, so a browser cannot call it, and keeping the call here keeps
// the timeout, the per-user rate limit and the cache under our control.
//
// What leaves this server is only what staff typed: first name, last name and
// state for a search, or the NPI for a lookup. No org, provider id or user
// detail is ever sent. What comes back is narrowed to public registry fields
// (NpiRegistryRecord) before it reaches a route.
//
// This module logs nothing; the route logs the failure kind, never the query.
import { isIsoDate } from "@/lib/providerIdentity";
import {
  NPI_REGISTRY_RESULT_CAP,
  NPI_REGISTRY_UNAVAILABLE_MESSAGE,
  foldNameForRegistry,
  type NpiRegistryLookupResult,
  type NpiRegistryName,
  type NpiRegistryRecord,
  type NpiRegistrySearchResult,
  type ValidNpiRegistrySearch,
} from "@/lib/npiRegistry";

export const NPPES_API_URL = "https://npiregistry.cms.hhs.gov/api/";
export const NPPES_TIMEOUT_MS = 5_000;
const MAX_TEXT = 120;

export type NpiRegistryFailureKind =
  "network" | "timeout" | "http" | "invalid_response" | "registry_error";

/** Every upstream failure, with one caller-facing message. `kind` and
 * `status` are for the server log only. */
export class NpiRegistryUnavailableError extends Error {
  constructor(
    readonly kind: NpiRegistryFailureKind,
    readonly status?: number,
  ) {
    super(NPI_REGISTRY_UNAVAILABLE_MESSAGE);
    this.name = "NpiRegistryUnavailableError";
  }
}

export interface NppesDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

async function callNppes(params: Record<string, string>, deps: NppesDeps): Promise<unknown> {
  const url = new URL(NPPES_API_URL);
  url.searchParams.set("version", "2.1");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const doFetch = deps.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(deps.timeoutMs ?? NPPES_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new NpiRegistryUnavailableError(
      name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new NpiRegistryUnavailableError("http", response.status);
  }
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new NpiRegistryUnavailableError(
      name === "TimeoutError" || name === "AbortError" ? "timeout" : "invalid_response",
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Registry text, trimmed and bounded. NPPES uses "--" for an empty name part.
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);
  return cleaned && cleaned !== "--" ? cleaned : null;
}

function primaryTaxonomy(value: unknown): NpiRegistryRecord["primaryTaxonomy"] {
  if (!Array.isArray(value)) return null;
  const rows = value.filter(isObject);
  const primary = rows.find((row) => row.primary === true) ?? rows[0];
  const code = primary ? text(primary.code) : null;
  return primary && code ? { code, description: text(primary.desc) } : null;
}

function practiceLocation(value: unknown): { city: string | null; state: string | null } {
  const rows = Array.isArray(value) ? value.filter(isObject) : [];
  const location = rows.find((row) => row.address_purpose === "LOCATION");
  return { city: text(location?.city), state: text(location?.state) };
}

function otherNames(value: unknown): NpiRegistryName[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((row) => ({ firstName: text(row.first_name), lastName: text(row.last_name) }))
    .filter((name) => name.firstName !== null && name.lastName !== null);
}

/** One registry result narrowed to public fields; null when it is not a
 * well-formed NPI-1 or NPI-2 record. */
export function toNpiRegistryRecord(raw: unknown): NpiRegistryRecord | null {
  if (!isObject(raw)) return null;
  const npi =
    typeof raw.number === "string" || typeof raw.number === "number" ? `${raw.number}` : "";
  if (!/^\d{10}$/.test(npi)) return null;
  const type = raw.enumeration_type;
  if (type !== "NPI-1" && type !== "NPI-2") return null;
  const basic = isObject(raw.basic) ? raw.basic : {};
  const location = practiceLocation(raw.addresses);
  const enumerationDate = text(basic.enumeration_date);
  return {
    npi,
    enumerationType: type,
    firstName: type === "NPI-1" ? text(basic.first_name) : null,
    middleName: type === "NPI-1" ? text(basic.middle_name) : null,
    lastName: type === "NPI-1" ? text(basic.last_name) : null,
    organizationName: type === "NPI-2" ? text(basic.organization_name) : null,
    credential: type === "NPI-1" ? text(basic.credential) : null,
    primaryTaxonomy: primaryTaxonomy(raw.taxonomies),
    practiceCity: location.city,
    practiceState: location.state,
    status: basic.status === "A" ? "active" : "inactive",
    enumerationDate: enumerationDate && isIsoDate(enumerationDate) ? enumerationDate : null,
    otherNames: type === "NPI-1" ? otherNames(raw.other_names) : [],
  };
}

/** The records in a registry response. An `Errors` body (the registry's own
 * rejection, sent with HTTP 200) or any other shape is a failure. */
export function parseNppesResponse(json: unknown): NpiRegistryRecord[] {
  if (!isObject(json)) throw new NpiRegistryUnavailableError("invalid_response");
  if ("Errors" in json) throw new NpiRegistryUnavailableError("registry_error");
  if (!Array.isArray(json.results)) {
    // Tolerate a zero count sent without a results array.
    if (json.result_count === 0) return [];
    throw new NpiRegistryUnavailableError("invalid_response");
  }
  return json.results.flatMap((row) => {
    const record = toNpiRegistryRecord(row);
    return record ? [record] : [];
  });
}

/** Individuals (NPI-1) by name, at most NPI_REGISTRY_RESULT_CAP of them. */
export async function searchNppes(
  input: ValidNpiRegistrySearch,
  deps: NppesDeps = {},
): Promise<NpiRegistrySearchResult> {
  const params: Record<string, string> = {
    enumeration_type: "NPI-1",
    first_name: foldNameForRegistry(input.firstName),
    last_name: foldNameForRegistry(input.lastName),
    limit: String(NPI_REGISTRY_RESULT_CAP + 1),
  };
  if (input.state) params.state = input.state;
  const records = parseNppesResponse(await callNppes(params, deps)).filter(
    (record) => record.enumerationType === "NPI-1",
  );
  return {
    results: records.slice(0, NPI_REGISTRY_RESULT_CAP),
    truncated: records.length > NPI_REGISTRY_RESULT_CAP,
  };
}

/** One NPI, individual or organization, so a Type 2 typed into a Type 1 field
 * can be named. */
export async function lookupNppes(
  npi: string,
  deps: NppesDeps = {},
): Promise<NpiRegistryLookupResult> {
  const records = parseNppesResponse(await callNppes({ number: npi }, deps));
  return { record: records.find((record) => record.npi === npi) ?? null };
}

/** A small TTL cache with a size bound; the oldest entry goes first. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** A fixed-window counter per key (one window per key, reset when it ends). */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): RateLimitDecision {
    const now = this.now();
    if (this.windows.size > 1_000) {
      for (const [k, window] of this.windows) {
        if (now - window.start >= this.windowMs) this.windows.delete(k);
      }
    }
    const current = this.windows.get(key);
    if (!current || now - current.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return { allowed: true };
    }
    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.start + this.windowMs - now) / 1000)),
      };
    }
    current.count += 1;
    return { allowed: true };
  }

  clear(): void {
    this.windows.clear();
  }
}
