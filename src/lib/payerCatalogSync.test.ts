// E1.6 F1.6.2/TE-5 — the seed pipeline's sync planner. TS-37's core lives
// here: an unchanged dataset plans zero inserts and zero diffs (idempotent
// re-seed). TS-38's detection half: a rename on a unique external ID becomes
// a name diff, never a direct overwrite.
import { describe, expect, it } from "vitest";
import {
  collapseKind,
  datasetFromCsv,
  emitSeedSql,
  planCatalogSync,
  type CatalogDatasetRow,
} from "../../scripts/payer-catalog-sync.mjs";

const row = (over: Partial<CatalogDatasetRow>): CatalogDatasetRow => ({
  slug: "bcbs-nc",
  name: "Blue Cross and Blue Shield of North Carolina",
  payerKind: "commercial",
  states: ["NC"],
  aliases: ["Blue Cross NC"],
  stediPayerId: "SB810",
  ...over,
});

describe("collapseKind (union -> one catalog kind)", () => {
  it("commercial wins for diversified carriers; single kinds pass through", () => {
    expect(collapseKind("commercial|medicaid_mco|medicare_advantage")).toBe("commercial");
    expect(collapseKind("medicaid_mco")).toBe("medicaid_mco");
    expect(collapseKind("medicare_advantage|medicaid_mco")).toBe("medicaid_mco");
    expect(collapseKind("tricare")).toBe("tricare");
    expect(collapseKind("")).toBe("commercial");
  });
});

describe("datasetFromCsv", () => {
  const csv = [
    "payer_slug,name,parent_org,payer_kind,lobs,states,state_count,aliases,clearinghouse_payer_id,payer_id_scope,stedi_slug,enrollment_required,id_source",
    'bcbs-nc,"Blue Cross and Blue Shield of North Carolina",BCBSNC,commercial,commercial,NC,1,Blue Cross NC|BCBSNC,SB810,per_state,,,src',
    "original-medicare-and-wyoming-medicaid-direct-ffs-enrollment,Original Medicare & Wyoming Medicaid (direct FFS enrollment),CMS,medicare|medicaid,medicare,WY,1,,,,,,",
  ].join("\n");

  it("normalizes rows and skips the WY rankings-artifact row", () => {
    const rows = datasetFromCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Blue Cross and Blue Shield of North Carolina",
      payerKind: "commercial",
      states: ["NC"],
      aliases: ["BCBSNC", "Blue Cross NC"],
      stediPayerId: "SB810",
    });
  });
});

describe("planCatalogSync", () => {
  it("first seed: everything inserts", () => {
    const plan = planCatalogSync([row({})], []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.diffs).toHaveLength(0);
  });

  it("TS-37: unchanged dataset plans zero inserts and zero diffs", () => {
    const plan = planCatalogSync(
      [row({})],
      [
        {
          name: "Blue Cross and Blue Shield of North Carolina",
          aliases: ["Blue Cross NC"],
          states: ["NC"],
          stedi_payer_id: "SB810",
          status: "active",
        },
      ],
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.diffs).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
    expect(plan.missing).toHaveLength(0);
  });

  it("TS-38 detection: rename on a unique external ID becomes a name diff, not an overwrite", () => {
    const plan = planCatalogSync(
      [row({ name: "Blue Cross NC (renamed upstream)" })],
      [
        {
          name: "Blue Cross and Blue Shield of North Carolina",
          aliases: ["Blue Cross NC"],
          states: ["NC"],
          stedi_payer_id: "SB810",
          status: "active",
        },
      ],
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.diffs).toEqual([
      {
        payerName: "Blue Cross and Blue Shield of North Carolina",
        field: "name",
        oldValue: "Blue Cross and Blue Shield of North Carolina",
        newValue: "Blue Cross NC (renamed upstream)",
      },
    ]);
  });

  it("shared clearinghouse IDs never cross-match plans (Centene 68069)", () => {
    const superior = row({
      slug: "superior-healthplan",
      name: "Superior HealthPlan (Centene)",
      states: ["TX"],
      aliases: [],
      stediPayerId: "68069",
    });
    const sunflower = row({
      slug: "sunflower-health-plan",
      name: "Sunflower Health Plan",
      states: ["KS"],
      aliases: [],
      stediPayerId: "68069",
    });
    // Existing has only Superior; Sunflower must insert, never ID-match Superior.
    const plan = planCatalogSync(
      [superior, sunflower],
      [
        {
          name: "Superior HealthPlan (Centene)",
          aliases: [],
          states: ["TX"],
          stedi_payer_id: "68069",
        },
      ],
    );
    expect(plan.inserts.map((r) => r.name)).toEqual(["Sunflower Health Plan"]);
    expect(plan.diffs).toHaveLength(0);
  });

  it("state/alias changes diff by set (order-insensitive); blank dataset ID never clears a stored one", () => {
    const plan = planCatalogSync(
      [row({ states: ["SC", "NC"], stediPayerId: null })],
      [
        {
          name: "Blue Cross and Blue Shield of North Carolina",
          aliases: ["Blue Cross NC"],
          states: ["NC"],
          stedi_payer_id: "SB810",
        },
      ],
    );
    expect(plan.diffs).toEqual([
      {
        payerName: "Blue Cross and Blue Shield of North Carolina",
        field: "states",
        oldValue: "NC",
        newValue: "NC|SC",
      },
    ]);
  });

  it("disappeared active payers are reported, never deleted or retired automatically", () => {
    const plan = planCatalogSync(
      [],
      [
        { name: "Gone Health Plan", aliases: [], states: ["TX"], stedi_payer_id: null },
        {
          name: "Already Retired",
          aliases: [],
          states: [],
          stedi_payer_id: null,
          status: "retired",
        },
      ],
    );
    expect(plan.missing).toEqual(["Gone Health Plan"]);
  });
});

describe("emitSeedSql", () => {
  it("emits idempotent inserts and guarded diff rows with escaped quotes", () => {
    const plan = planCatalogSync(
      [
        row({
          name: "Martin's Point Generations Advantage",
          aliases: [],
          states: ["ME"],
          stediPayerId: null,
        }),
      ],
      [],
    );
    const sql = emitSeedSql(plan);
    expect(sql).toContain("ON CONFLICT (lower(name)) WHERE org_id IS NULL DO NOTHING");
    expect(sql).toContain("'Martin''s Point Generations Advantage'");
    const diffSql = emitSeedSql({
      inserts: [],
      unchanged: 0,
      missing: [],
      diffs: [{ payerName: "A", field: "name", oldValue: "A", newValue: "B" }],
    });
    expect(diffSql).toContain("review_state = 'unreviewed'");
    expect(diffSql).toContain("NOT EXISTS");
  });
});
