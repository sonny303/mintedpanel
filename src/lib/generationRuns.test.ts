// E2.4 TE-10 — the pure run-trace derivations: disposition counts (child rows
// supersede the stored plan; zero rows fall back to the plan, flagged),
// partial-batch honesty, manual-vs-generated origin, and the derived reapply
// timeline (task clusters by creation timestamp with their version stamps).
import { describe, expect, it } from "vitest";
import {
  caseOrigin,
  deriveRunCounts,
  deriveTaskCycles,
  runRecordStatus,
} from "@/lib/generationRuns";

const RUN = {
  proposedCount: 3,
  createdCount: 3,
  skippedExistingCount: 2,
  excludedCount: 1,
  failedCount: 0,
};

const row = (disposition: "created" | "skipped_existing" | "excluded" | "failed") => ({
  disposition,
});

describe("deriveRunCounts", () => {
  it("derives counts from the child rows when any exist — the stored plan never disagrees at read time", () => {
    const counts = deriveRunCounts(RUN, [
      row("created"),
      row("created"),
      row("skipped_existing"),
      row("skipped_existing"),
      row("excluded"),
      row("failed"),
    ]);
    expect(counts).toEqual({
      created: 2,
      skippedExisting: 2,
      excluded: 1,
      failed: 1,
      skipped: 0,
      enrolled: 0,
      recorded: 6,
      fromPlan: false,
    });
  });

  it("falls back to the stored plan when no rows exist (pre-E2.4 run), flagged as plan", () => {
    const counts = deriveRunCounts(RUN, []);
    expect(counts).toEqual({
      created: 3,
      skippedExisting: 2,
      excluded: 1,
      failed: 0,
      skipped: 0,
      enrolled: 0,
      recorded: 0,
      fromPlan: true,
    });
  });
});

describe("runRecordStatus (partial-batch honesty)", () => {
  it("a fully recorded run is not short", () => {
    const status = runRecordStatus(RUN, new Array(6).fill({}));
    expect(status).toEqual({ expected: 6, recorded: 6, endedEarly: false });
  });

  it("fewer rows than the confirm-time candidate total reads as ended early", () => {
    const status = runRecordStatus(RUN, new Array(4).fill({}));
    expect(status).toEqual({ expected: 6, recorded: 4, endedEarly: true });
  });
});

describe("caseOrigin (F2.4.2)", () => {
  it("a run-created case names its run", () => {
    expect(
      caseOrigin({
        generationRunId: "run-1",
        createdByName: "Sowmya Seed",
        createdAt: "2026-07-13T00:00:00Z",
      }),
    ).toEqual({
      kind: "generation",
      runId: "run-1",
      actorName: "Sowmya Seed",
      createdAt: "2026-07-13T00:00:00Z",
    });
  });

  it("a NULL run id is a manual origin (manual one-offs and every pre-E2.1 row)", () => {
    expect(
      caseOrigin({ generationRunId: null, createdByName: null, createdAt: "2026-07-01T00:00:00Z" }),
    ).toEqual({ kind: "manual", actorName: null, createdAt: "2026-07-01T00:00:00Z" });
    expect(caseOrigin({ createdAt: "2026-07-01T00:00:00Z" }).kind).toBe("manual");
  });
});

describe("deriveTaskCycles (TE-6 reapply lineage, derived never stored)", () => {
  const task = (createdAt: string, sopTemplateId: string | null, sopVersion: number | null) => ({
    caseId: "c-1",
    createdAt,
    sopTemplateId,
    sopVersion,
  });

  it("clusters tasks by creation timestamp, oldest first, with distinct stamps per cycle", () => {
    const cycles = deriveTaskCycles([
      // Reapply cycle (appended later, restamped at v2) listed first on
      // purpose — ordering must come from the timestamps, not input order.
      task("2026-07-10T09:00:00Z", "tpl-1", 2),
      task("2026-04-02T08:00:00Z", "tpl-1", 1),
      task("2026-04-02T08:00:00Z", "tpl-1", 1),
      task("2026-07-10T09:00:00Z", "tpl-1", 2),
      task("2026-07-10T09:00:00Z", "tpl-1", 2),
    ]);
    expect(cycles).toEqual([
      {
        createdAt: "2026-04-02T08:00:00Z",
        taskCount: 2,
        stamps: [{ sopTemplateId: "tpl-1", sopVersion: 1 }],
      },
      {
        createdAt: "2026-07-10T09:00:00Z",
        taskCount: 3,
        stamps: [{ sopTemplateId: "tpl-1", sopVersion: 2 }],
      },
    ]);
  });

  it("a single-cycle case yields one cluster; legacy unstamped tasks contribute no stamps", () => {
    const cycles = deriveTaskCycles([
      task("2026-04-02T08:00:00Z", null, null),
      task("2026-04-02T08:00:00Z", null, null),
    ]);
    expect(cycles).toEqual([{ createdAt: "2026-04-02T08:00:00Z", taskCount: 2, stamps: [] }]);
  });

  it("no tasks yields no cycles", () => {
    expect(deriveTaskCycles([])).toEqual([]);
  });
});
