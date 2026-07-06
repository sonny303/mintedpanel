import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

import {
  getProviderProfile,
  type ProviderProfile,
  type ProviderProfileResult,
  type ProviderProfileServiceCtx,
} from "./providerProfile";

// Minimal chainable fake of the supabase-js query builder, keyed by table name.
// A table may be queried more than once (facilities: the id/name facility set,
// then the selected facility's full row) — give it an ARRAY of results and each
// from() call consumes the next one, in call order. Also fakes `.rpc()` for the
// get_sop_field_tokens catalog.
interface Captured {
  table: string;
  selectCols?: string;
  filters: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
  orders: Array<[string, { ascending: boolean; nullsFirst?: boolean } | undefined]>;
}

interface FakeResult {
  data: unknown;
  error?: unknown;
}

function makeFakeDb(
  tables: Record<string, FakeResult | FakeResult[]>,
  catalog: FakeResult = { data: null },
) {
  const captures: Captured[] = [];
  const rpcCalls: string[] = [];
  const queues = new Map<string, FakeResult[]>();

  const db = {
    from(table: string) {
      const cap: Captured = { table, filters: [], ins: [], orders: [] };
      captures.push(cap);
      const configured = tables[table];
      let fixed: FakeResult;
      if (Array.isArray(configured)) {
        if (!queues.has(table)) queues.set(table, [...configured]);
        fixed = queues.get(table)?.shift() ?? { data: null };
      } else {
        fixed = configured ?? { data: null };
      }
      const builder: Record<string, unknown> = {
        select(cols: string) {
          cap.selectCols = cols;
          return builder;
        },
        eq(col: string, val: unknown) {
          cap.filters.push([col, val]);
          return builder;
        },
        in(col: string, vals: unknown[]) {
          cap.ins.push([col, vals]);
          return builder;
        },
        order(col: string, opts?: { ascending: boolean; nullsFirst?: boolean }) {
          cap.orders.push([col, opts]);
          return builder;
        },
        maybeSingle: () => Promise.resolve(fixed),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(fixed).then(res, rej),
      };
      return builder;
    },
    rpc(name: string) {
      rpcCalls.push(name);
      return Promise.resolve({ error: null, ...catalog });
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, captures, rpcCalls };
}

function ctxWith(db: SupabaseClient<Database>): ProviderProfileServiceCtx {
  return { db, orgId: "org-1" };
}

const CATALOG: Json = [
  { table: "providers", token: "provider.firstName", column: "first_name" },
  { table: "provider_groups", token: "group.name", column: "name" },
  { table: "state_licenses", token: "license.licenseNumber", column: "license_number" },
  { table: "facilities", token: "facility.name", column: "name" },
  { table: "provider_facility_assignments", token: "assignment.isPrimary", column: "is_primary" },
  {
    table: "group_insurance_policies",
    token: "groupInsurance.policyNumber",
    column: "policy_number",
  },
  { table: "payers", token: "payer.name", column: "name" },
  { table: "msos", token: "mso.portalUrl", column: "portal_url" },
];

const providerRow = {
  id: "p1",
  group_id: "g1",
  first_name: "Ana",
  last_name: "Beck",
  ssn_last4: "1234",
};
const groupRow = { id: "g1", name: "Group One" };
const licenseKS = { id: "l1", state: "KS", license_number: "KS-100", issue_date: "2024-01-01" };
const licenseMO = { id: "l2", state: "MO", license_number: "MO-200", issue_date: "2023-06-01" };
const assignmentF1 = { id: "a1", facility_id: "f1", is_primary: true };
const assignmentF2 = { id: "a2", facility_id: "f2", is_primary: false };
const facilityListF1 = { id: "f1", name: "Main Clinic" };
const facilityListF2 = { id: "f2", name: "Second Clinic" };
const facilityRowF1 = { id: "f1", name: "Main Clinic" };
const facilityRowF2 = { id: "f2", name: "Second Clinic" };
const policyRow = { id: "gp1", policy_number: "POL-9" };

function happyTables(): Record<string, FakeResult | FakeResult[]> {
  return {
    providers: { data: providerRow },
    provider_groups: { data: groupRow },
    state_licenses: { data: [licenseKS] },
    provider_facility_assignments: { data: [assignmentF1] },
    group_insurance_policies: { data: [policyRow] },
    // Queried twice: the org-scoped facility set (id, name), then the selected
    // facility's full-column row.
    facilities: [{ data: [facilityListF1] }, { data: facilityRowF1 }],
  };
}

function must(result: ProviderProfileResult): ProviderProfile {
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected an ok profile result");
  return result.profile;
}

function valueOf(profile: ProviderProfile, token: string): Json | null | undefined {
  return profile.tokens.find((t) => t.token === token)?.value;
}

function reasonFor(profile: ProviderProfile, token: string): string {
  return profile.unresolved.find((u) => u.token === token)?.reason ?? "";
}

describe("provider profile service — injected server context", () => {
  it("a provider outside the org resolves to provider_not_found before the catalog is read", async () => {
    const { db, captures, rpcCalls } = makeFakeDb(
      { providers: { data: null } },
      {
        data: CATALOG,
      },
    );

    const result = await getProviderProfile(ctxWith(db), "p1");

    expect(result).toEqual({ kind: "provider_not_found" });
    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe("providers");
    expect(captures[0].filters).toContainEqual(["id", "p1"]);
    expect(captures[0].filters).toContainEqual(["org_id", "org-1"]);
    expect(rpcCalls).toHaveLength(0);
  });

  it("resolves every catalog token from the picked source rows, org-scoping every query", async () => {
    const { db, captures, rpcCalls } = makeFakeDb(happyTables(), { data: CATALOG });

    const profile = must(await getProviderProfile(ctxWith(db), "p1"));

    expect(rpcCalls).toEqual(["get_sop_field_tokens"]);
    // Every catalog entry appears in tokens, resolved or not.
    expect(profile.tokens).toHaveLength((CATALOG as unknown[]).length);
    expect(valueOf(profile, "provider.firstName")).toBe("Ana");
    expect(valueOf(profile, "group.name")).toBe("Group One");
    expect(valueOf(profile, "license.licenseNumber")).toBe("KS-100");
    expect(valueOf(profile, "facility.name")).toBe("Main Clinic");
    expect(valueOf(profile, "assignment.isPrimary")).toBe(true);
    expect(valueOf(profile, "groupInsurance.policyNumber")).toBe("POL-9");

    // A sole facility is auto-selected and reported in the payload.
    expect(profile.facilities).toEqual([{ id: "f1", name: "Main Clinic" }]);
    expect(profile.selected_facility_id).toBe("f1");

    // Case-scoped sources are never resolved from a provider profile.
    expect(valueOf(profile, "payer.name")).toBeNull();
    expect(reasonFor(profile, "payer.name")).toContain("case-scoped");
    expect(valueOf(profile, "mso.portalUrl")).toBeNull();
    expect(reasonFor(profile, "mso.portalUrl")).toContain("case-scoped");

    // The provider comes back camelized.
    expect(profile.provider).toMatchObject({ id: "p1", firstName: "Ana", lastName: "Beck" });

    // Isolation: every table query carries the org filter.
    expect(captures.length).toBeGreaterThan(1);
    for (const cap of captures) {
      expect(cap.filters).toContainEqual(["org_id", "org-1"]);
    }
    // The facility set is fetched by the assignments' facility ids (id + name
    // only), then the selected facility's full row by id.
    const facilityCaps = captures.filter((c) => c.table === "facilities");
    expect(facilityCaps).toHaveLength(2);
    expect(facilityCaps[0].selectCols).toBe("id, name");
    expect(facilityCaps[0].ins).toEqual([["id", ["f1"]]]);
    expect(facilityCaps[0].orders.map(([col]) => col)).toEqual(["name", "id"]);
    expect(facilityCaps[1].filters).toContainEqual(["id", "f1"]);
    // Licenses come back newest-first so ?state picks deterministically.
    const licenseCap = captures.find((c) => c.table === "state_licenses");
    expect(licenseCap?.orders).toEqual([["issue_date", { ascending: false, nullsFirst: false }]]);
  });

  it("?state picks the matching license among several", async () => {
    const tables = happyTables();
    tables.state_licenses = { data: [licenseKS, licenseMO] };
    const { db } = makeFakeDb(tables, { data: CATALOG });

    const profile = must(await getProviderProfile(ctxWith(db), "p1", { state: "MO" }));

    expect(valueOf(profile, "license.licenseNumber")).toBe("MO-200");
    expect(profile.unresolved.some((u) => u.token === "license.licenseNumber")).toBe(false);
  });

  it("several licenses without ?state leave the license token null with a ?state hint", async () => {
    const tables = happyTables();
    tables.state_licenses = { data: [licenseKS, licenseMO] };
    const { db } = makeFakeDb(tables, { data: CATALOG });

    const profile = must(await getProviderProfile(ctxWith(db), "p1"));

    expect(valueOf(profile, "license.licenseNumber")).toBeNull();
    expect(reasonFor(profile, "license.licenseNumber")).toContain("?state");
  });

  it("several facilities without ?facilityId stay empty with needsFacility — a primary is NOT auto-picked", async () => {
    const tables = happyTables();
    // Two facilities, one marked primary: the old primary-assignment heuristic
    // must not resurface — the server never guesses, the client asks the user.
    tables.provider_facility_assignments = { data: [assignmentF1, assignmentF2] };
    tables.facilities = [{ data: [facilityListF1, facilityListF2] }];
    const { db, captures } = makeFakeDb(tables, { data: CATALOG });

    const result = await getProviderProfile(ctxWith(db), "p1");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.needsFacility).toBe(true);
    const profile = result.profile;
    expect(profile.selected_facility_id).toBeNull();
    expect(profile.facilities).toEqual([
      { id: "f1", name: "Main Clinic" },
      { id: "f2", name: "Second Clinic" },
    ]);
    expect(valueOf(profile, "facility.name")).toBeNull();
    expect(reasonFor(profile, "facility.name")).toContain("?facilityId=");
    expect(valueOf(profile, "assignment.isPrimary")).toBeNull();
    expect(reasonFor(profile, "assignment.isPrimary")).toContain("?facilityId=");
    // Non-facility tokens are untouched by the ambiguity.
    expect(valueOf(profile, "provider.firstName")).toBe("Ana");
    // No full facility row is fetched when nothing was selected.
    expect(captures.filter((c) => c.table === "facilities")).toHaveLength(1);
  });

  it("?facilityId selects among several facilities; assignment tokens follow the selection", async () => {
    const tables = happyTables();
    tables.provider_facility_assignments = { data: [assignmentF1, assignmentF2] };
    tables.facilities = [{ data: [facilityListF1, facilityListF2] }, { data: facilityRowF2 }];
    const { db } = makeFakeDb(tables, { data: CATALOG });

    const result = await getProviderProfile(ctxWith(db), "p1", { facilityId: "f2" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.needsFacility).toBe(false);
    const profile = result.profile;
    expect(profile.selected_facility_id).toBe("f2");
    expect(valueOf(profile, "facility.name")).toBe("Second Clinic");
    // The f2 assignment row, not the primary f1 one.
    expect(valueOf(profile, "assignment.isPrimary")).toBe(false);
  });

  it("a ?facilityId outside the provider's set or the org is facility_not_found, resolving nothing", async () => {
    // The org-scoped facility-set query is what enforces both halves: a
    // cross-org id and an unassigned same-org id both fall out of the set.
    const { db, captures, rpcCalls } = makeFakeDb(happyTables(), { data: CATALOG });

    const result = await getProviderProfile(ctxWith(db), "p1", { facilityId: "f-other" });

    expect(result).toEqual({ kind: "facility_not_found" });
    // Only the id/name set was read; no full facility row, no token resolution.
    expect(captures.filter((c) => c.table === "facilities")).toHaveLength(1);
    expect(rpcCalls).toEqual(["get_sop_field_tokens"]);
  });

  it("a provider with no assignments resolves facility and assignment tokens to null without a facilities query", async () => {
    const tables = happyTables();
    tables.provider_facility_assignments = { data: [] };
    const { db, captures } = makeFakeDb(tables, { data: CATALOG });

    const result = await getProviderProfile(ctxWith(db), "p1");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.needsFacility).toBe(false);
    const profile = result.profile;
    expect(profile.facilities).toEqual([]);
    expect(profile.selected_facility_id).toBeNull();
    expect(valueOf(profile, "facility.name")).toBeNull();
    expect(reasonFor(profile, "facility.name")).toBe("provider has no facility assignments");
    expect(valueOf(profile, "assignment.isPrimary")).toBeNull();
    expect(captures.some((c) => c.table === "facilities")).toBe(false);
  });

  it("a provider with no group leaves group and policy tokens unresolved, without group queries", async () => {
    const { db, captures } = makeFakeDb(
      {
        providers: { data: { ...providerRow, group_id: null } },
        state_licenses: { data: [licenseKS] },
        provider_facility_assignments: { data: [assignmentF1] },
        facilities: [{ data: [facilityListF1] }, { data: facilityRowF1 }],
      },
      { data: CATALOG },
    );

    const profile = must(await getProviderProfile(ctxWith(db), "p1"));

    expect(valueOf(profile, "group.name")).toBeNull();
    expect(reasonFor(profile, "group.name")).toBe("provider has no group");
    expect(valueOf(profile, "groupInsurance.policyNumber")).toBeNull();
    expect(reasonFor(profile, "groupInsurance.policyNumber")).toBe("provider has no group");
    expect(captures.some((c) => c.table === "provider_groups")).toBe(false);
    expect(captures.some((c) => c.table === "group_insurance_policies")).toBe(false);
  });

  it("survives catalog entries pointing at unknown columns or unsupported tables", async () => {
    const oddCatalog: Json = [
      { table: "providers", token: "provider.mystery", column: "mystery_column" },
      { table: "space_stations", token: "station.name", column: "name" },
    ];
    const { db } = makeFakeDb(happyTables(), { data: oddCatalog });

    const profile = must(await getProviderProfile(ctxWith(db), "p1"));

    expect(valueOf(profile, "provider.mystery")).toBeNull();
    expect(reasonFor(profile, "provider.mystery")).toContain("not in the providers projection");
    expect(valueOf(profile, "station.name")).toBeNull();
    expect(reasonFor(profile, "station.name")).toContain(
      "unsupported source table (space_stations)",
    );
  });
});
