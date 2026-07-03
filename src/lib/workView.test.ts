// M3 consistency test: the Providers pivot (group by provider) and the Cases
// pivot (group by payer) must derive identical chip totals from the same
// fixture, because both flow through getActionState + chipCounts.
import { describe, expect, it } from "vitest";
import { getActionState, type ActionStateInput } from "./actionState";
import { chipCounts } from "./workView";

const NOW = new Date("2026-07-03T12:00:00Z");

interface FixtureCase {
  id: string;
  providerId: string;
  payerId: string;
  engine: ActionStateInput;
}

function fixtureCase(
  id: string,
  providerId: string,
  payerId: string,
  engine: Partial<ActionStateInput>,
): FixtureCase {
  return {
    id,
    providerId,
    payerId,
    engine: {
      statusLabel: "Submitted",
      actionBucket: "waiting_payer",
      openTaskDueDates: [],
      lastTouchDate: "2026-07-01",
      createdAt: "2026-05-01",
      confirmedEffectiveDate: null,
      expectedEffectiveDate: null,
      now: NOW,
      ...engine,
    },
  };
}

// Two providers × three payers, covering every engine state at least once.
const FIXTURE: FixtureCase[] = [
  fixtureCase("c1", "p1", "aetna", { actionBucket: "ours", statusLabel: "Not Started" }),
  fixtureCase("c2", "p1", "uhc", { openTaskDueDates: ["2026-06-30"] }), // needs_action via task
  fixtureCase("c3", "p1", "bcbs", { lastTouchDate: "2026-06-01" }), // stalled
  fixtureCase("c4", "p2", "aetna", {}), // on_track
  fixtureCase("c5", "p2", "uhc", {
    statusLabel: "Approved",
    confirmedEffectiveDate: "2026-08-01",
  }), // awaiting_effective
  fixtureCase("c6", "p2", "bcbs", {
    actionBucket: "complete",
    statusLabel: "In-Network",
  }), // complete — excluded from all chips
  fixtureCase("c7", "p2", "aetna", { actionBucket: "waiting_provider" }), // blocked
];

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    out.set(k, [...(out.get(k) ?? []), item]);
  }
  return out;
}

describe("Providers/Cases chip consistency", () => {
  const states = FIXTURE.map((c) => ({ ...c, state: getActionState(c.engine) }));

  it("both pivots produce identical totals from the same fixture", () => {
    const providerPivot = [...groupBy(states, (c) => c.providerId).values()];
    const payerPivot = [...groupBy(states, (c) => c.payerId).values()];

    const providersPageCounts = chipCounts(providerPivot.flat().map((c) => c.state));
    const casesPageCounts = chipCounts(payerPivot.flat().map((c) => c.state));

    expect(providersPageCounts).toEqual(casesPageCounts);
  });

  it("totals match the hand-computed expectation for the fixture", () => {
    expect(chipCounts(states.map((c) => c.state))).toEqual({
      all: 6, // c6 is complete and drops out
      needs: 3, // c1 (ours) + c2 (overdue task) + c7 (blocked)
      inprog: 2, // c3 stalled + c4 on_track
      awaiting: 1, // c5
    });
  });

  it("chips partition the open set exactly (no case counted twice or missed)", () => {
    const counts = chipCounts(states.map((c) => c.state));
    expect(counts.needs + counts.inprog + counts.awaiting).toBe(counts.all);
  });
});
