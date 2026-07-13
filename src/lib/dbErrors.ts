// E0.10 F0.10.5 (TE-5). The E0.10 database floor rejects bad writes with raw
// Postgres errors; this translator turns the ones a human can act on into
// domain messages at the service boundary. Codes: 23505 unique_violation,
// 23514 check_violation, 23502 not_null_violation. Anything unrecognized is
// returned unchanged so existing error handling keeps working — services
// `throw translateDbError(error)` instead of `throw error` on constrained
// write paths.

interface PgErrorLike {
  code?: string;
  message?: string;
}

function pgShape(error: unknown): PgErrorLike | null {
  if (typeof error !== "object" || error === null) return null;
  const e = error as Record<string, unknown>;
  const code = typeof e.code === "string" ? e.code : undefined;
  const message = typeof e.message === "string" ? e.message : undefined;
  if (!code && !message) return null;
  return { code, message };
}

// Constraint-name fragment → human message. Postgres names the violated
// constraint in the error message, so matching on the fragment works for both
// direct PostgREST errors and RPC-surfaced ones.
const UNIQUE_MESSAGES: ReadonlyArray<readonly [fragment: string, message: string]> = [
  [
    "contracts_group_id_payer_id_state_key",
    "A contract already exists for this group, payer, and state.",
  ],
  // E2.1 4-part key (20260713150000). The old 3-part fragment row below is
  // kept harmlessly — the constraint no longer exists, but stale error text
  // in flight should still translate.
  [
    "credential_cases_provider_group_payer_state_key",
    "A case already exists for this provider, group, payer, and state.",
  ],
  [
    "credential_cases_provider_id_payer_id_state_key",
    "A case already exists for this provider, payer, and state.",
  ],
  [
    "uq_state_licenses_provider_state_number",
    "This provider already has a license with this number in this state.",
  ],
  ["uq_provider_facility_assignments_one_primary", "This provider already has a primary facility."],
  [
    "provider_facility_assignments_provider_id_facility_id_key",
    "This provider is already assigned to this facility.",
  ],
  [
    "status_configs_org_id_track_label_key",
    "A status with this label already exists in this track.",
  ],
];

const CHECK_MESSAGES: ReadonlyArray<readonly [fragment: string, message: string]> = [
  ["_state_format", "State must be a two-letter code (for example TX)."],
  ["tasks_owner_check", "A task must belong to a case or a provider."],
  ["contracts_group_id_not_null", "A contract requires a provider group."],
  ["contracts_payer_id_not_null", "A contract requires a payer."],
  [
    "provider_facility_assignments_provider_id_not_null",
    "A facility assignment requires a provider.",
  ],
  [
    "provider_facility_assignments_facility_id_not_null",
    "A facility assignment requires a facility.",
  ],
  ["state_licenses_provider_id_not_null", "A license requires a provider."],
];

function matchFragment(
  message: string,
  table: ReadonlyArray<readonly [string, string]>,
): string | null {
  for (const [fragment, friendly] of table) {
    if (message.includes(fragment)) return friendly;
  }
  return null;
}

/** 23505 unique_violation, post-translation. The E2.1 generation confirm
 *  loop classifies on this type to turn a duplicate-key insert into a
 *  "skipped — already exists" disposition instead of a failure. */
export class UniqueViolationError extends Error {}

/** Translate a Postgres constraint violation into an Error with a domain
 *  message; anything unrecognized comes back unchanged. Usage:
 *  `if (error) throw translateDbError(error);` */
export function translateDbError(error: unknown): unknown {
  const pg = pgShape(error);
  if (!pg?.message) return error;

  if (pg.code === "23505") {
    const friendly = matchFragment(pg.message, UNIQUE_MESSAGES);
    return new UniqueViolationError(friendly ?? "This record already exists.");
  }
  if (pg.code === "23514") {
    const friendly = matchFragment(pg.message, CHECK_MESSAGES);
    return friendly ? new Error(friendly) : error;
  }
  if (pg.code === "23502") {
    // `null value in column "group_id" of relation "contracts" ...`
    const column = /null value in column "([^"]+)"/.exec(pg.message)?.[1];
    return new Error(
      column ? `${column.replaceAll("_", " ")} is required.` : "A required field is missing.",
    );
  }
  return error;
}
