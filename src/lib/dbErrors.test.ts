import { describe, expect, it } from "vitest";
import { translateDbError, UniqueViolationError } from "./dbErrors";

const pgError = (code: string, message: string) => ({ code, message });

function messageOf(result: unknown): string {
  expect(result).toBeInstanceOf(Error);
  return (result as Error).message;
}

describe("translateDbError — 23505 unique violations", () => {
  it("names the contract grain", () => {
    const result = translateDbError(
      pgError(
        "23505",
        'duplicate key value violates unique constraint "contracts_group_id_payer_id_state_key"',
      ),
    );
    expect(messageOf(result)).toBe("A contract already exists for this group, payer, and state.");
  });

  it("names the duplicate-primary invariant", () => {
    const result = translateDbError(
      pgError(
        "23505",
        'duplicate key value violates unique constraint "uq_provider_facility_assignments_one_primary"',
      ),
    );
    expect(messageOf(result)).toBe("This provider already has a primary facility.");
  });

  it("names the status-label invariant", () => {
    const result = translateDbError(
      pgError(
        "23505",
        'duplicate key value violates unique constraint "status_configs_org_id_track_label_key"',
      ),
    );
    expect(messageOf(result)).toBe("A status with this label already exists in this track.");
  });

  it("falls back to a generic duplicate message for unknown unique constraints", () => {
    const result = translateDbError(
      pgError("23505", 'duplicate key value violates unique constraint "something_else_key"'),
    );
    expect(messageOf(result)).toBe("This record already exists.");
  });

  // E2.1 TE-4: the 4-part-key swap must not silently revert duplicate-case
  // errors to raw Postgres text — the new constraint name translates, and
  // every 23505 is typed so the generation confirm loop can classify it as
  // skipped_existing.
  it("names the 4-part case grain (E2.1 constraint swap)", () => {
    const result = translateDbError(
      pgError(
        "23505",
        'duplicate key value violates unique constraint "credential_cases_provider_group_payer_state_key"',
      ),
    );
    expect(messageOf(result)).toBe(
      "A case already exists for this provider, group, payer, and state.",
    );
    expect(result).toBeInstanceOf(UniqueViolationError);
  });

  it("still translates the retired 3-part fragment (stale errors in flight)", () => {
    const result = translateDbError(
      pgError(
        "23505",
        'duplicate key value violates unique constraint "credential_cases_provider_id_payer_id_state_key"',
      ),
    );
    expect(messageOf(result)).toBe("A case already exists for this provider, payer, and state.");
    expect(result).toBeInstanceOf(UniqueViolationError);
  });
});

describe("translateDbError — 23514 check violations", () => {
  it("translates any state-format check", () => {
    const result = translateDbError(
      pgError(
        "23514",
        'new row for relation "credential_cases" violates check constraint "credential_cases_state_format"',
      ),
    );
    expect(messageOf(result)).toBe("State must be a two-letter code (for example TX).");
  });

  it("translates the task-owner check", () => {
    const result = translateDbError(
      pgError(
        "23514",
        'new row for relation "tasks" violates check constraint "tasks_owner_check"',
      ),
    );
    expect(messageOf(result)).toBe("A task must belong to a case or a provider.");
  });

  it("translates the per-column NOT-NULL floor checks", () => {
    const result = translateDbError(
      pgError(
        "23514",
        'new row for relation "contracts" violates check constraint "contracts_payer_id_not_null"',
      ),
    );
    expect(messageOf(result)).toBe("A contract requires a payer.");
  });

  it("translates the facility-assignment start-date check", () => {
    const result = translateDbError(
      pgError(
        "23514",
        'new row for relation "provider_facility_assignments" violates check constraint "provider_facility_assignments_start_date_check"',
      ),
    );
    expect(messageOf(result)).toBe("A facility assignment requires a start date.");
  });

  it("passes an unknown check violation through unchanged", () => {
    const original = pgError(
      "23514",
      'new row for relation "touches" violates check constraint "touches_shape_check"',
    );
    expect(translateDbError(original)).toBe(original);
  });
});

describe("translateDbError — 23502 not-null violations", () => {
  it("names the missing column", () => {
    const result = translateDbError(
      pgError(
        "23502",
        'null value in column "group_id" of relation "contracts" violates not-null constraint',
      ),
    );
    expect(messageOf(result)).toBe("group id is required.");
  });

  it("falls back when the column is not parseable", () => {
    const result = translateDbError(pgError("23502", "violates not-null constraint"));
    expect(messageOf(result)).toBe("A required field is missing.");
  });
});

describe("translateDbError — everything else passes through", () => {
  it("returns non-constraint errors unchanged", () => {
    const original = pgError("PGRST116", "no rows");
    expect(translateDbError(original)).toBe(original);
    const plain = new Error("network down");
    expect(translateDbError(plain)).toBe(plain);
    expect(translateDbError(null)).toBeNull();
    expect(translateDbError("boom")).toBe("boom");
  });
});
