import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

import {
  getProviderProfile,
  type ProviderProfile,
  type ProviderProfileServiceCtx,
} from "./providerProfile";

// Minimal chainable fake of the supabase-js query builder, keyed by table name
// (getProviderProfile queries each source table at most once, partly inside a
// Promise.all). Also fakes `.rpc()` for the get_sop_field_tokens catalog.
interface Captured {
  table: string;
  selectCols?: string;
  filters: Array<[string, unknown]>;
  orders: Array<[string, { ascending: boolean; nullsFirst?: boolean }]>;
}

interface FakeResult {
  data: unknown;
  error?: unknown;
}

function makeFakeDb(tables: Record<string, FakeResult>, catalog: FakeResult = { data: null }) {
  const captures: Captured[] = [];
  const rpcCalls: string[] = [];

  const db = {
    from(table: string) {
      const cap: Captured = { table, filters: [], orders: [] };
      captures.push(cap);
      const result = () => tables[table] ?? { data: null };
      const builder: Record<string, unknown> = {
        select(cols: string) {
          cap.selectCols = cols;
          return builder;
        },
        eq(col: string, val: unknown) {
          cap.filters.push([col, val]);
          return builder;
        },
        order(col: string, opts: { ascending: boolean; nullsFirst?: boolean }) {
          cap.orders.push([col, opts]);
          return builder;
        },
        maybeSingle: () => Promise.resolve(result()),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(res, rej),
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
const assignmentRow = { id: "a1", facility_id: "f1", is_primary: true };
const facilityRow = { id: "f1", name: "Main Clinic" };
const policyRow = { id: "gp1", policy_number: "POL-9" };

function happyTables(): Record<string, FakeResult> {
  return {
    providers: { data: providerRow },
    provider_groups: { data: groupRow },
    state_licenses: { data: [licenseKS] },
    provider_facility_assignments: { data: [assignmentRow] },
    group_insurance_policies: { data: [policyRow] },
    facilities: { data: facilityRow },
  };
}

function must(profile: ProviderProfile | null): ProviderProfile {
  expect(profile).not.toBeNull();
  if (profile === null) throw new Error("expected a profile");
  return profile;
}

function valueOf(profile: ProviderProfile, token: string): Json | null | undefined {
  return profile.tokens.find((t) => t.token === token)?.value;
}

function reasonFor(profile: ProviderProfile, token: string): string {
  return profile.unresolved.find((u) => u.token === token)?.reason ?? "";
}

describe("provider profile service — injected server context", () => {
  it("a provider outside the org resolves to null before the catalog is read", async () => {
    const { db, captures, rpcCalls } = makeFakeDb(
      { providers: { data: null } },
      {
        data: CATALOG,
      },
    );

    const profile = await getProviderProfile(ctxWith(db), "p1");

    expect(profile).toBeNull();
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
    expect(valueOf(profile, "groupInsurance.policyNumber")).toBe("POL-9");

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
    // The facility is fetched from the picked assignment.
    const facilityCap = captures.find((c) => c.table === "facilities");
    expect(facilityCap?.filters).toContainEqual(["id", "f1"]);
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

  it("a provider with no group leaves group and policy tokens unresolved, without group queries", async () => {
    const { db, captures } = makeFakeDb(
      {
        providers: { data: { ...providerRow, group_id: null } },
        state_licenses: { data: [licenseKS] },
        provider_facility_assignments: { data: [assignmentRow] },
        facilities: { data: facilityRow },
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
