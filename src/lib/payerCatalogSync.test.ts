// E1.6 F1.6.2/TE-5 — the seed pipeline's sync planner, keyed on the canonical
// payer_slug (the identity/dedupe key; clearinghouse IDs are ignored per the
// final [e1.6] decision). TS-37's core lives here: an unchanged dataset plans
// zero inserts and zero diffs (idempotent re-seed). TS-38's detection half: a
// rename on a matched slug becomes a name diff, never a direct overwrite.
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
    "original-medicare-and-wyoming-medicaid,Original Medicare & Wyoming Medicaid (direct FFS enrollment),CMS,medicare|medicaid,medicare,WY,1,,,,,,",
  ].join("\n");

  it("keys rows on payer_slug, IGNORES the clearinghouse-ID column, skips the WY artifact row", () => {
    const rows = datasetFromCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      slug: "bcbs-nc",
      name: "Blue Cross and Blue Shield of North Carolina",
      payerKind: "commercial",
      states: ["NC"],
      aliases: ["BCBSNC", "Blue Cross NC"],
    });
    expect(Object.keys(rows[0])).not.toContain("stediPayerId");
  });
});

describe("planCatalogSync", () => {
  const existingBcbsNc = {
    payer_slug: "bcbs-nc",
    name: "Blue Cross and Blue Shield of North Carolina",
    aliases: ["Blue Cross NC"],
    states: ["NC"],
    status: "active",
  };

  it("first seed: everything inserts", () => {
    const plan = planCatalogSync([row({})], []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.diffs).toHaveLength(0);
    expect(plan.slugBackfills).toHaveLength(0);
  });

  it("TS-37: unchanged dataset plans zero inserts and zero diffs", () => {
    const plan = planCatalogSync([row({})], [existingBcbsNc]);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.diffs).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
    expect(plan.missing).toHaveLength(0);
  });

  it("TS-38 detection: a rename on a matched slug becomes a name diff, not an overwrite", () => {
    const plan = planCatalogSync(
      [row({ name: "Blue Cross NC (renamed upstream)" })],
      [existingBcbsNc],
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.diffs).toEqual([
      {
        payerSlug: "bcbs-nc",
        payerName: "Blue Cross and Blue Shield of North Carolina",
        field: "name",
        oldValue: "Blue Cross and Blue Shield of North Carolina",
        newValue: "Blue Cross NC (renamed upstream)",
      },
    ]);
  });

  it("slugless legacy rows are matched by name and planned as slug backfills, not inserts", () => {
    const plan = planCatalogSync([row({})], [{ ...existingBcbsNc, payer_slug: null }]);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.slugBackfills).toEqual([
      { slug: "bcbs-nc", name: "Blue Cross and Blue Shield of North Carolina" },
    ]);
    expect(plan.unchanged).toBe(1);
  });

  it("distinct slugs never cross-match, even with identical names", () => {
    const a = row({ slug: "healthy-blue", name: "Healthy Blue", states: ["NC"] });
    const b = row({ slug: "healthy-blue-kansas", name: "Healthy Blue", states: ["KS"] });
    const plan = planCatalogSync(
      [a, b],
      [
        {
          payer_slug: "healthy-blue",
          name: "Healthy Blue",
          aliases: ["Blue Cross NC"],
          states: ["NC"],
        },
      ],
    );
    expect(plan.inserts.map((r) => r.slug)).toEqual(["healthy-blue-kansas"]);
    expect(plan.diffs).toHaveLength(0);
  });

  it("state/alias changes diff by set (order-insensitive)", () => {
    const plan = planCatalogSync([row({ states: ["SC", "NC"] })], [existingBcbsNc]);
    expect(plan.diffs).toEqual([
      {
        payerSlug: "bcbs-nc",
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
        { payer_slug: "gone", name: "Gone Health Plan", aliases: [], states: ["TX"] },
        { payer_slug: "old", name: "Already Retired", aliases: [], states: [], status: "retired" },
      ],
    );
    expect(plan.missing).toEqual(["Gone Health Plan"]);
  });
});

describe("emitSeedSql", () => {
  it("emits slug-keyed idempotent inserts, backfills, and guarded diff rows", () => {
    const insertPlan = planCatalogSync(
      [
        row({
          slug: "martins-point",
          name: "Martin's Point Generations Advantage",
          aliases: [],
          states: ["ME"],
        }),
      ],
      [],
    );
    const sql = emitSeedSql(insertPlan);
    expect(sql).toContain("ON CONFLICT (payer_slug) WHERE payer_slug IS NOT NULL DO NOTHING");
    expect(sql).toContain("'Martin''s Point Generations Advantage'");
    expect(sql).toContain("'martins-point'");

    const diffSql = emitSeedSql({
      inserts: [],
      unchanged: 0,
      missing: [],
      slugBackfills: [{ slug: "bcbs-nc", name: "Old Name" }],
      diffs: [
        { payerSlug: "bcbs-nc", payerName: "A", field: "name", oldValue: "A", newValue: "B" },
      ],
    });
    expect(diffSql).toContain("SET payer_slug = 'bcbs-nc'");
    expect(diffSql).toContain("WHERE p.payer_slug = 'bcbs-nc' AND p.org_id IS NULL");
    expect(diffSql).toContain("review_state = 'unreviewed'");
    expect(diffSql).toContain("NOT EXISTS");
  });
});
