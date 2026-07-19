// E6.6 F6.6.3 — denials-report display assembly + CSV tests (TS-136 shapes).
import { describe, expect, it } from "vitest";
import { buildDenialRows } from "./caseRollups";
import {
  buildDenialsCsv,
  buildDenialsCsvRows,
  cycleStateLabel,
  decorateDenialRows,
  DENIALS_CSV_HEADERS,
} from "./denialsReport";

const rows = buildDenialRows(
  [
    { id: "c1", providerId: "pr1", payerId: "p1", state: "NC", status: "denied" },
    { id: "c2", providerId: "pr2", payerId: "p1", state: "NC", status: "in_progress" },
    { id: "c3", providerId: "pr1", payerId: "p2", state: "SC", status: "approved" },
  ],
  new Map([
    ["c1", { reasonLabel: "Network Closed", deniedAt: "2026-06-01" }],
    ["c2", { reasonLabel: "Missing Documentation", deniedAt: "2026-05-15" }],
    ["c3", { reasonLabel: null, deniedAt: "2026-04-01" }],
  ]),
);

const providerNames = new Map([
  ["pr1", "Chen, Amy"],
  ["pr2", "Baker, Tom"],
]);
const payerNames = new Map([
  ["p1", "Anthem"],
  ["p2", "Cigna"],
]);

describe("decorateDenialRows", () => {
  it("attaches names and sorts provider-name-first", () => {
    const decorated = decorateDenialRows(rows, providerNames, payerNames);
    expect(decorated.map((r) => `${r.providerName}|${r.payerName}`)).toEqual([
      "Baker, Tom|Anthem",
      "Chen, Amy|Anthem",
      "Chen, Amy|Cigna",
    ]);
  });

  it("unknown ids render honestly", () => {
    const decorated = decorateDenialRows(rows, new Map(), new Map());
    expect(decorated[0].providerName).toBe("Unknown provider");
    expect(decorated[0].payerName).toBe("Unknown payer");
  });
});

describe("cycleStateLabel", () => {
  it("standing vs reapplied-with-destination", () => {
    expect(cycleStateLabel({ cycleState: "standing", currentStatus: "denied" })).toBe("Standing");
    expect(cycleStateLabel({ cycleState: "reapplied", currentStatus: "in_progress" })).toBe(
      "Reapplied — now In Progress",
    );
    expect(cycleStateLabel({ cycleState: "reapplied", currentStatus: "approved" })).toBe(
      "Reapplied — now Approved",
    );
  });
});

describe("CSV", () => {
  it("emits the header row + one row per denial with reason/date/cycle", () => {
    const decorated = decorateDenialRows(rows, providerNames, payerNames);
    const csvRows = buildDenialsCsvRows(decorated);
    expect(csvRows[0]).toEqual([...DENIALS_CSV_HEADERS]);
    expect(csvRows).toHaveLength(4);
    const c1 = csvRows.find((r) => r[6] === "c1");
    expect(c1).toEqual([
      "Chen, Amy",
      "Anthem",
      "NC",
      "Network Closed",
      "2026-06-01",
      "Standing",
      "c1",
    ]);
    const c2 = csvRows.find((r) => r[6] === "c2");
    expect(c2?.[5]).toBe("Reapplied — now In Progress");
  });

  it("serializes via the shared csv machinery", () => {
    const decorated = decorateDenialRows(rows, providerNames, payerNames);
    const csv = buildDenialsCsv(decorated);
    expect(csv.split("\n")[0]).toBe(DENIALS_CSV_HEADERS.join(","));
    expect(csv).toContain("Network Closed");
  });
});
