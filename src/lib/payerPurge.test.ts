// 3M payer-setup cleanup, Slice 2 — the dead-catalog purge is the only
// destructive migration in this audit, so its guard is pinned by shape.
//
// The danger it must never regress into: SEVEN of the fifteen FK columns that
// reference payers are ON DELETE CASCADE (case_generation_exclusions,
// case_generation_run_rows, enrollment_facts, org_payer_assignments,
// org_payer_settings, payer_contacts, payer_network_targets). A delete that
// checked only the BLOCKING references would not error — it would silently
// take immutable generation-ledger rows and live enrollment facts with it.
// So "the guard names every referencing table" is a correctness property, not
// tidiness, and it is exactly the kind of thing a later edit would shave down.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PURGE = readFileSync(
  join(ROOT, "supabase/migrations/20260810120000_purge_unreferenced_catalog_payers.sql"),
  "utf8",
).toLowerCase();

/** Every table carrying an FK to payers, from pg_constraint on the live DB.
 * `payers` itself is here for the merged_into_id self-reference. */
const REFERENCING_TABLES = [
  "case_generation_exclusions",
  "case_generation_run_rows",
  "communication_event",
  "contracts",
  "credential_cases",
  "enrollment_facts",
  "mso_routing_rules",
  "org_payer_assignments",
  "org_payer_settings",
  "payer_catalog_changes",
  "payer_contacts",
  "payer_network_targets",
  "portals",
  "sop_templates",
] as const;

describe("the catalog purge migration (20260810120000)", () => {
  it("checks EVERY table that references payers, cascading ones included", () => {
    for (const table of REFERENCING_TABLES) {
      expect(PURGE, `${table} is unguarded — a delete would cascade or fail`).toContain(
        `from public.${table}`,
      );
    }
  });

  it("guards the merged_into_id self-reference", () => {
    // Deleting a merge survivor would orphan the loser's pointer.
    expect(PURGE).toContain("merged_into_id");
  });

  it("only ever deletes GLOBAL, non-manual, non-merged payers", () => {
    expect(PURGE).toContain("p.org_id is null");
    expect(PURGE).toContain("coalesce(p.source, '') <> 'manual'");
    expect(PURGE).toContain("coalesce(p.status, '') <> 'merged'");
  });

  it("deletes only from payers — never from a referencing table", () => {
    const deletes = PURGE.match(/delete\s+from\s+(public\.)?[a-z_]+/g) ?? [];
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(/delete\s+from\s+public\.payers/);
  });

  it("carries the NOT IN referenced guard — the whole point of the migration", () => {
    // Without this clause the WHERE would match all 262 unreferenced rows AND
    // every referenced global row seeded by the retired sync.
    expect(PURGE).toMatch(/not in \(select id from referenced/);
  });

  it("reports what it did instead of deleting silently", () => {
    expect(PURGE).toContain("raise notice");
    expect(PURGE).toContain("get diagnostics");
  });
});
