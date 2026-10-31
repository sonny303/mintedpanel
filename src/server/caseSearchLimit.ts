// How many matching cases one extension case search answers with
// (GET /api/cases?q=). Sowmya's decision of Oct 30, 2026 (Mission Control
// plan D17) makes this a platform-admin setting with a default of 5, edited in
// Mission Control's settings screen (milestone M6). That screen and its
// `platform_settings` table do not exist yet, so the reader below defaults to
// "no setting" and every search gets CASE_SEARCH_DEFAULT_LIMIT.
//
// This is the one seam: the route resolves the limit here, passes it to
// searchOrgCases, and sends it to clients as `meta.limit`, so the extension
// follows the server instead of a constant of its own. M6 supplies the
// platform-settings reader here and nowhere else.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** The limit when no platform setting says otherwise. */
export const CASE_SEARCH_DEFAULT_LIMIT = 5;

/** Reads the platform setting's raw value; null or undefined means "not set". */
export type CaseSearchLimitReader = (db: SupabaseClient<Database>) => Promise<unknown>;

// No platform settings table exists before Mission Control M6.
const noPlatformSetting: CaseSearchLimitReader = async () => null;

/** A positive whole number is the limit. Anything else (unset, zero,
 * negative, fractional, text) is the default, so a bad setting can never
 * empty the results or break the search. */
export function normalizeCaseSearchLimit(raw: unknown): number {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
    ? raw
    : CASE_SEARCH_DEFAULT_LIMIT;
}

/** The limit for this request: the platform setting when one is set,
 * otherwise CASE_SEARCH_DEFAULT_LIMIT. */
export async function resolveCaseSearchLimit(
  db: SupabaseClient<Database>,
  readSetting: CaseSearchLimitReader = noPlatformSetting,
): Promise<number> {
  return normalizeCaseSearchLimit(await readSetting(db));
}
