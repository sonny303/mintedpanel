// /api/npi-registry/* — MINT-110 staff lookups in the NPI Registry (NPPES).
//
//   POST /api/npi-registry/search  { firstName, lastName, state? }
//     → { results: NpiRegistryRecord[], truncated }   individuals (NPI-1), ≤ 10
//   POST /api/npi-registry/lookup  { npi }
//     → { record: NpiRegistryRecord | null }          null = not in the registry
//
// POST, not GET, so typed names and NPIs stay out of URLs and request logs.
// Both run behind the full org guard (authenticate()) and are writer-only: the
// only consumers are the provider create/edit forms. They read no org data and
// write no audit row — the registry is public, and nothing here is stored.
//
// Limits are per server instance: a per-user fixed window and a short TTL
// cache, both in memory. On Vercel every function instance keeps its own
// copies and loses them on a cold start, so the limit is best effort, not a
// guarantee (TECH-DEBT.md). The cache is shared across users and orgs on
// purpose: an answer depends only on the query, never on who asked.
import { fail, ok } from "./envelope";
import { isWriter, type AuthContext } from "./guard";
import {
  FixedWindowRateLimiter,
  NpiRegistryUnavailableError,
  TtlCache,
  lookupNppes,
  searchNppes,
  type NppesDeps,
} from "./npiRegistry";
import {
  NPI_REGISTRY_RATE_LIMIT_MESSAGE,
  NPI_REGISTRY_UNAVAILABLE_MESSAGE,
  validateNpiRegistryLookup,
  validateNpiRegistrySearch,
  type NpiRegistryLookupResult,
  type NpiRegistrySearchResult,
} from "@/lib/npiRegistry";

export const NPI_REGISTRY_RATE_LIMIT = 30;
export const NPI_REGISTRY_RATE_WINDOW_MS = 60_000;
export const NPI_REGISTRY_CACHE_TTL_MS = 10 * 60_000;
export const NPI_REGISTRY_CACHE_MAX = 500;

type CachedAnswer = NpiRegistrySearchResult | NpiRegistryLookupResult;

let limiter = new FixedWindowRateLimiter(NPI_REGISTRY_RATE_LIMIT, NPI_REGISTRY_RATE_WINDOW_MS);
let cache = new TtlCache<CachedAnswer>(NPI_REGISTRY_CACHE_TTL_MS, NPI_REGISTRY_CACHE_MAX);

/** Tests only: fresh limiter and cache, optionally on a fake clock. */
export function resetNpiRegistryLimits(now: () => number = Date.now): void {
  limiter = new FixedWindowRateLimiter(NPI_REGISTRY_RATE_LIMIT, NPI_REGISTRY_RATE_WINDOW_MS, now);
  cache = new TtlCache<CachedAnswer>(NPI_REGISTRY_CACHE_TTL_MS, NPI_REGISTRY_CACHE_MAX, now);
}

function privateResponse(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

// Role, then input, then the per-user budget — so a malformed or forbidden
// request never spends the budget and never reaches the registry.
function precheck(ctx: AuthContext): Response | null {
  if (!isWriter(ctx)) {
    return privateResponse(fail(403, "Only admins and specialists can search the NPI Registry"));
  }
  return null;
}

function spendBudget(ctx: AuthContext): Response | null {
  const decision = limiter.take(ctx.userId);
  if (decision.allowed) return null;
  const response = privateResponse(fail(429, NPI_REGISTRY_RATE_LIMIT_MESSAGE));
  response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  return response;
}

async function answer<T extends CachedAnswer>(
  key: string,
  load: () => Promise<T>,
): Promise<Response> {
  const cached = cache.get(key) as T | undefined;
  if (cached) return privateResponse(ok(cached));
  try {
    const result = await load();
    cache.set(key, result);
    return privateResponse(ok(result));
  } catch (error) {
    if (error instanceof NpiRegistryUnavailableError) {
      // The failure kind and upstream status only — never the query.
      console.warn(
        `[npi-registry] upstream unavailable: ${error.kind}${error.status ? ` ${error.status}` : ""}`,
      );
      return privateResponse(fail(502, NPI_REGISTRY_UNAVAILABLE_MESSAGE));
    }
    throw error;
  }
}

export async function handleNpiRegistrySearch(
  body: unknown,
  ctx: AuthContext,
  deps: NppesDeps = {},
): Promise<Response> {
  const denied = precheck(ctx);
  if (denied) return denied;
  const input = validateNpiRegistrySearch(body);
  if (!input.ok) return privateResponse(fail(422, input.error));
  const limited = spendBudget(ctx);
  if (limited) return limited;
  const { firstName, lastName, state } = input.value;
  const key = `search:${[firstName, lastName, state ?? ""].join("|").toUpperCase()}`;
  return answer(key, () => searchNppes(input.value, deps));
}

export async function handleNpiRegistryLookup(
  body: unknown,
  ctx: AuthContext,
  deps: NppesDeps = {},
): Promise<Response> {
  const denied = precheck(ctx);
  if (denied) return denied;
  const input = validateNpiRegistryLookup(body);
  if (!input.ok) return privateResponse(fail(422, input.error));
  const limited = spendBudget(ctx);
  if (limited) return limited;
  return answer(`npi:${input.value}`, () => lookupNppes(input.value, deps));
}
