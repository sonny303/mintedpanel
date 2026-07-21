import { describe, it, expect } from "vitest";
import {
  kpiCounts,
  matchesKpi,
  filterRows,
  statesInRows,
  sortFlatRows,
  groupRows,
  needsAction,
  paginate,
  pageCount,
  EMPTY_FILTERS,
  type CaseViewRow,
} from "./casesView";
import type { CaseStatus } from "./caseStatus";

let seq = 0;
function row(over: Partial<CaseViewRow> = {}): CaseViewRow {
  seq += 1;
  return {
    caseId: `c-${seq}`,
    caseNumber: 1000 + seq,
    providerId: `p-${seq}`,
    providerName: `Provider ${seq}`,
    providerCredentials: "PT",
    payerId: `pay-${seq}`,
    payerName: `Payer ${seq}`,
    isPreCred: false,
    state: "CO",
    caseStatus: "in_progress" as CaseStatus,
    confirmedEffectiveDate: null,
    lastTouchLabel: "—",
    lastTouchDays: null,
    daysOpen: 0,
    createdAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

describe("KPI counts (derived filters, not statuses)", () => {
  const rows = [
    row({ caseStatus: "in_progress" }),
    row({ caseStatus: "in_progress" }),
    row({ caseStatus: "approved", confirmedEffectiveDate: null }), // awaiting
    row({ caseStatus: "approved", confirmedEffectiveDate: "2026-08-01" }), // NOT awaiting
    row({ caseStatus: "denied" }),
    row({ caseStatus: "not_started" }),
  ];

  it("counts Total / In progress / Awaiting effective / Denied", () => {
    expect(kpiCounts(rows)).toEqual({ total: 6, inprog: 2, awaiting: 1, denied: 1 });
  });

  it("awaiting = Approved AND no confirmed effective date", () => {
    expect(
      matchesKpi(row({ caseStatus: "approved", confirmedEffectiveDate: null }), "awaiting"),
    ).toBe(true);
    expect(
      matchesKpi(row({ caseStatus: "approved", confirmedEffectiveDate: "2026-08-01" }), "awaiting"),
    ).toBe(false);
    // an in_progress case is never "awaiting"
    expect(matchesKpi(row({ caseStatus: "in_progress" }), "awaiting")).toBe(false);
  });

  it("Total matches everything", () => {
    expect(rows.every((r) => matchesKpi(r, "total"))).toBe(true);
  });
});

describe("filterRows composes KPI + state + status + search (AND)", () => {
  const a = row({
    providerName: "Jim Apple",
    payerName: "Aetna",
    state: "AZ",
    caseStatus: "denied",
  });
  const b = row({
    providerName: "Sarah Nguyen",
    payerName: "Aetna",
    state: "CO",
    caseStatus: "in_progress",
  });
  const rows = [a, b];

  it("no filters = all rows", () => {
    expect(filterRows(rows, EMPTY_FILTERS)).toHaveLength(2);
  });
  it("state filter", () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, state: "AZ" })).toEqual([a]);
  });
  it("status filter", () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, status: "in_progress" })).toEqual([b]);
  });
  it("search matches provider OR payer, case-insensitive", () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, search: "jim" })).toEqual([a]);
    expect(filterRows(rows, { ...EMPTY_FILTERS, search: "aetna" })).toHaveLength(2);
  });
  it("KPI + status compose (denied KPI + in_progress status = empty)", () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, kpi: "denied", status: "in_progress" })).toEqual(
      [],
    );
  });
  it("statesInRows is the distinct sorted set", () => {
    expect(statesInRows(rows)).toEqual(["AZ", "CO"]);
  });
});

describe("sortFlatRows", () => {
  it("default sort follows the E2.3 rank; unranked (terminal) cases come after, newest first", () => {
    const open1 = row({ caseId: "open-1", caseStatus: "in_progress" });
    const open2 = row({ caseId: "open-2", caseStatus: "action_required" });
    const term1 = row({
      caseId: "term-1",
      caseStatus: "approved",
      createdAt: "2026-07-05T00:00:00Z",
    });
    const term2 = row({
      caseId: "term-2",
      caseStatus: "denied",
      createdAt: "2026-07-10T00:00:00Z",
    });
    // queue ranks open-2 before open-1
    const rank = new Map([
      ["open-2", 0],
      ["open-1", 1],
    ]);
    const sorted = sortFlatRows([term1, open1, term2, open2], "default", "asc", rank);
    expect(sorted.map((r) => r.caseId)).toEqual(["open-2", "open-1", "term-2", "term-1"]);
  });

  it("caseNumber sort respects direction", () => {
    const r1 = row({ caseNumber: 1001 });
    const r2 = row({ caseNumber: 1005 });
    const r3 = row({ caseNumber: 1003 });
    const empty = new Map<string, number>();
    expect(sortFlatRows([r2, r1, r3], "caseNumber", "asc", empty).map((r) => r.caseNumber)).toEqual(
      [1001, 1003, 1005],
    );
    expect(
      sortFlatRows([r2, r1, r3], "caseNumber", "desc", empty).map((r) => r.caseNumber),
    ).toEqual([1005, 1003, 1001]);
  });

  it("status sort is spine order (not alphabetical)", () => {
    const s = (st: CaseStatus) => row({ caseStatus: st });
    const rows = [s("approved"), s("not_started"), s("submitted"), s("in_progress")];
    const sorted = sortFlatRows(rows, "status", "asc", new Map());
    expect(sorted.map((r) => r.caseStatus)).toEqual([
      "not_started",
      "in_progress",
      "submitted",
      "approved",
    ]);
  });

  it("lastTouch sorts never-touched last regardless of direction", () => {
    const touched = row({ caseId: "t", lastTouchDays: 2 });
    const never = row({ caseId: "n", lastTouchDays: null });
    expect(
      sortFlatRows([never, touched], "lastTouch", "asc", new Map()).map((r) => r.caseId),
    ).toEqual(["t", "n"]);
    expect(
      sortFlatRows([touched, never], "lastTouch", "desc", new Map()).map((r) => r.caseId),
    ).toEqual(["t", "n"]);
  });
});

describe("groupRows", () => {
  const meta = { subtitleFor: (k: string) => `sub-${k}` };

  it("By provider: needsAction = open 'ours'-bucket cases; approved = terminal wins (mirrors the Jim Apple screenshot)", () => {
    // Jim: Not Started, Not Started, Action Required, Approved → 3 needs action, 1 approved
    const jim = (st: CaseStatus, id: string) =>
      row({ caseId: id, providerId: "jim", providerName: "Jim Apple", caseStatus: st });
    const groups = groupRows(
      [
        jim("not_started", "a"),
        jim("not_started", "b"),
        jim("action_required", "c"),
        jim("approved", "d"),
      ],
      "provider",
      meta,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].total).toBe(4);
    expect(groups[0].approved).toBe(1);
    expect(groups[0].needsAction).toBe(3);
    expect(groups[0].subtitle).toBe("sub-jim");
  });

  it("submitted/in_review are waiting-payer, NOT needs-action", () => {
    expect(needsAction(row({ caseStatus: "submitted" }))).toBe(false);
    expect(needsAction(row({ caseStatus: "in_review" }))).toBe(false);
    expect(needsAction(row({ caseStatus: "action_required" }))).toBe(true);
  });

  it("By payer pins the Pre-Credentialing group last", () => {
    const normal = row({
      payerId: "aetna",
      payerName: "Aetna",
      isPreCred: false,
      caseStatus: "in_progress",
    });
    const pre = row({
      payerId: "pre",
      payerName: "Pre-Credentialing",
      isPreCred: true,
      caseStatus: "in_progress",
    });
    const groups = groupRows([pre, normal], "payer", meta);
    expect(groups[groups.length - 1].isPreCred).toBe(true);
  });
});

describe("pagination", () => {
  it("paginate slices by 1-based page", () => {
    const items = [1, 2, 3, 4, 5];
    expect(paginate(items, 1, 2)).toEqual([1, 2]);
    expect(paginate(items, 3, 2)).toEqual([5]);
  });
  it("pageCount is at least 1", () => {
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(22, 10)).toBe(3);
    expect(pageCount(20, 10)).toBe(2);
  });
});
