// How many matching cases one extension case search answers with
// (GET /api/cases?q=). Sowmya's decision of Oct 30, 2026 (Mission Control
// plan D17) makes this a platform-admin setting with a default of 5 and, per
// the Platform Settings IA sketch, a maximum of 50, edited in Mission
// Control's settings screen (milestone M6). That screen and its
// `platform_settings` table do not exist yet, so the reader below defaults to
// "no setting" and every search gets CASE_SEARCH_DEFAULT_LIMIT.
//
// This is the one seam: the route resolves the limit here, passes it to
// searchOrgCases, and sends it to clients as `meta.limit`, so the extension
// follows the server instead of a constant of its own. Services are the only
// Supabase callers (AGENTS.md), so M6 adds the platform-settings read as a
// `src/services/` function and injects it here as the reader; this module
// never queries a table itself. When M6 lands, the default, the maximum and
// normalizeCaseSearchLimit move to `src/lib/` (or the settings registry) so
// the settings screen validates with the same rule the server applies.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** The limit when no platform setting says otherwise. */
export const CASE_SEARCH_DEFAULT_LIMIT = 5;

/** The most a platform setting can raise it to. */
export const CASE_SEARCH_MAX_LIMIT = 50;

/** Reads the platform setting's raw value; null or undefined means "not set". */
export type CaseSearchLimitReader = (db: SupabaseClient<Database>) => Promise<unknown>;

// No platform settings table exists before Mission Control M6.
const noPlatformSetting: CaseSearchLimitReader = async () => null;

/** A positive whole number is the limit, capped at CASE_SEARCH_MAX_LIMIT.
 * Anything else (unset, zero, negative, fractional, text) is the default, so
 * a bad setting can never empty the results or break the search. */
export function normalizeCaseSearchLimit(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) {
    return CASE_SEARCH_DEFAULT_LIMIT;
  }
  return Math.min(raw, CASE_SEARCH_MAX_LIMIT);
}

/** The limit for this request: the platform setting when one is set,
 * otherwise CASE_SEARCH_DEFAULT_LIMIT; never more than CASE_SEARCH_MAX_LIMIT. */
export async function resolveCaseSearchLimit(
  db: SupabaseClient<Database>,
  readSetting: CaseSearchLimitReader = noPlatformSetting,
): Promise<number> {
  return normalizeCaseSearchLimit(await readSetting(db));
}
