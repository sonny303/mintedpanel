import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface TableCalls {
  select: unknown[][];
  eq: Array<[string, unknown]>;
  neq: Array<[string, unknown]>;
  range: Array<[number, number]>;
}

const holder = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  calls: {} as Record<string, TableCalls>,
}));

// A PostgREST stand-in that applies eq/neq to its rows, so the filters are
// proved by what comes back, and pages ranged reads with an exact count.
function fakeTable(name: string) {
  const calls: TableCalls = { select: [], eq: [], neq: [], range: [] };
  holder.calls[name] = calls;
  const matching = () =>
    (holder.tables[name] ?? []).filter(
      (row) =>
        calls.eq.every(([column, value]) => row[column] === value) &&
        calls.neq.every(([column, value]) => row[column] !== value),
    );
  const builder = {
    select: (...args: unknown[]) => {
      calls.select.push(args);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      calls.eq.push([column, value]);
      return builder;
    },
    neq: (column: string, value: unknown) => {
      calls.neq.push([column, value]);
      return builder;
    },
    order: () => builder,
    range: async (from: number, to: number) => {
      calls.range.push([from, to]);
      const rows = matching();
      return { data: rows.slice(from, to + 1), count: rows.length, error: null };
    },
  };
  return builder;
}

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: (name: string) => fakeTable(name) },
}));
vi.mock("@/lib/audit", () => ({ requireActiveOrg: () => "org-1" }));

import { buildOnboardingFunnelRows, onboardingFunnelStageCounts } from "@/lib/onboardingFunnel";
import { getOnboardingFunnelInput } from "./onboardingFunnel";

const DOB = "1987-06-05";
const SSN_LAST4 = "9876";

function provider(id: string, over: Row = {}): Row {
  return {
    id,
    org_id: "org-1",
    first_name: "Ana",
    last_name: id,
    npi: "1234567893",
    caqh_id: "CAQH-1",
    caqh_last_attested_date: "2026-10-01",
    date_of_birth: DOB,
    ssn_last4: SSN_LAST4,
    verification_state: "verified",
    reference_only: false,
    status: "active",
    is_test_provider: false,
    ...over,
  };
}

describe("onboarding funnel service", () => {
  beforeEach(() => {
    holder.calls = {};
    holder.tables = {
      providers: [
        provider("p-active"),
        provider("p-onboarding", { status: "onboarding", date_of_birth: null, ssn_last4: " " }),
        provider("p-terminated", { status: "terminated" }),
        provider("p-test", { is_test_provider: true }),
        provider("p-reference", { reference_only: true }),
        provider("p-other-org", { org_id: "org-2" }),
      ],
      state_licenses: Array.from({ length: 620 }, (_, i) => ({
        id: `l-${String(i).padStart(4, "0")}`,
        org_id: "org-1",
        provider_id: "p-active",
        state: "NC",
        status: i === 0 ? "inactive" : "active",
        verified_status: "verified",
        expiration_date: "2027-06-30",
      })),
      facilities: [
        { id: "f-on", org_id: "org-1", state: "NC", is_active: true, reference_only: false },
        { id: "f-off", org_id: "org-1", state: "SC", is_active: false, reference_only: false },
      ],
      provider_facility_assignments: [
        { id: "a-1", org_id: "org-1", provider_id: "p-active", facility_id: "f-on" },
        { id: "a-2", org_id: "org-1", provider_id: "p-active", facility_id: "f-off" },
      ],
      provider_groups: [
        { id: "g-on", org_id: "org-1", is_active: true },
        { id: "g-off", org_id: "org-1", is_active: false },
      ],
      provider_group_assignments: [
        { id: "m-1", org_id: "org-1", provider_id: "p-active", group_id: "g-on", end_date: null },
        {
          id: "m-2",
          org_id: "org-1",
          provider_id: "p-onboarding",
          group_id: "g-on",
          end_date: "2026-01-31",
        },
        {
          id: "m-3",
          org_id: "org-1",
          provider_id: "p-onboarding",
          group_id: "g-off",
          end_date: null,
        },
      ],
      credential_cases: [
        {
          id: "c-1",
          org_id: "org-1",
          provider_id: "p-active",
          state: "NC",
          case_status: "submitted",
        },
      ],
    };
  });

  it("reduces date of birth and SSN last 4 to booleans and returns no raw value", async () => {
    const input = await getOnboardingFunnelInput();
    expect(input.providers).toEqual([
      expect.objectContaining({ providerId: "p-active", dobPresent: true, ssnLast4Present: true }),
      expect.objectContaining({
        providerId: "p-onboarding",
        dobPresent: false,
        ssnLast4Present: false,
      }),
    ]);
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain(DOB);
    expect(serialized).not.toContain(SSN_LAST4);
    for (const row of input.providers) {
      for (const key of ["dateOfBirth", "ssnLast4", "date_of_birth", "ssn_last4"]) {
        expect(row).not.toHaveProperty(key);
      }
    }
  });

  it("counts only this org's non-terminated, non-test, non-reference providers", async () => {
    const input = await getOnboardingFunnelInput();
    expect(input.providers.map((row) => row.providerId)).toEqual(["p-active", "p-onboarding"]);
    expect(holder.calls.providers.neq).toEqual([
      ["status", "terminated"],
      ["is_test_provider", true],
    ]);
    for (const table of Object.values(holder.calls)) {
      expect(table.eq).toContainEqual(["org_id", "org-1"]);
      expect(table.select[0][1]).toEqual({ count: "exact" });
    }
  });

  it("pages every read to completion and keeps only active licenses and locations", async () => {
    const input = await getOnboardingFunnelInput();
    expect(holder.calls.state_licenses.range).toEqual([
      [0, 499],
      [500, 999],
    ]);
    expect(input.licenses).toHaveLength(619);
    expect(input.workStates).toEqual([{ providerId: "p-active", state: "NC" }]);
    expect(input.cases).toEqual([{ providerId: "p-active", state: "NC" }]);
  });

  it("leaves reference-only locations out, so they never make a provider Ready", async () => {
    holder.tables.providers = [provider("p-ref")];
    holder.tables.state_licenses = [
      {
        id: "l-ref",
        org_id: "org-1",
        provider_id: "p-ref",
        state: "TX",
        status: "active",
        verified_status: "verified",
        expiration_date: "2027-06-30",
      },
    ];
    holder.tables.facilities = [
      { id: "f-ref", org_id: "org-1", state: "TX", is_active: true, reference_only: true },
    ];
    holder.tables.provider_facility_assignments = [
      { id: "a-ref", org_id: "org-1", provider_id: "p-ref", facility_id: "f-ref" },
    ];
    holder.tables.provider_group_assignments = [
      { id: "m-ref", org_id: "org-1", provider_id: "p-ref", group_id: "g-on", end_date: null },
    ];
    holder.tables.credential_cases = [];
    const input = await getOnboardingFunnelInput();
    expect(holder.calls.facilities.select[0][0]).toContain("reference_only");
    expect(input.workStates).toEqual([]);
    expect(buildOnboardingFunnelRows(input, "2026-10-20")).toMatchObject([
      { providerId: "p-ref", stage: "submitted", gaps: ["Needs a location"] },
    ]);
  });

  it("reads group memberships in active groups only and leaves the end date to the funnel", async () => {
    const input = await getOnboardingFunnelInput();
    // A membership that starts in the future already counts: no start date.
    expect(holder.calls.provider_group_assignments.select[0][0]).not.toContain("start_date");
    expect(input.groupMemberships).toEqual([
      { providerId: "p-active", endDate: null },
      { providerId: "p-onboarding", endDate: "2026-01-31" },
    ]);
  });

  it("cannot read the intake tables, so the Invited stage stays hidden", async () => {
    const input = await getOnboardingFunnelInput();
    expect(input.intakeReadable).toBe(false);
    expect(Object.keys(holder.calls).filter((table) => table.includes("intake"))).toEqual([]);
  });

  it("counts a provider whose only case is denied in Credentialing", async () => {
    holder.tables.providers = [provider("p-denied")];
    holder.tables.state_licenses = [];
    holder.tables.provider_facility_assignments = [];
    holder.tables.provider_group_assignments = [];
    holder.tables.credential_cases = [
      { id: "c-9", org_id: "org-1", provider_id: "p-denied", state: "NC", case_status: "denied" },
    ];
    const input = await getOnboardingFunnelInput();
    // No case-status column is read: every case counts.
    expect(String(holder.calls.credential_cases.select[0][0])).not.toMatch(/status/);
    const rows = buildOnboardingFunnelRows(input, "2026-10-20");
    expect(rows.map((row) => [row.providerId, row.stage])).toEqual([["p-denied", "credentialing"]]);
    expect(onboardingFunnelStageCounts(rows)).toEqual({
      invited: 0,
      profile_incomplete: 0,
      submitted: 0,
      ready_for_credentialing: 0,
      credentialing: 1,
    });
  });
});
