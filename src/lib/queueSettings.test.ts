import { describe, expect, it } from "vitest";
import {
  buildQueueRankingRow,
  DEFAULT_QUEUE_RANKING_ORDER,
  isDefaultOrder,
  moveGroup,
  QUEUE_RANKING_GROUPS,
  QUEUE_RANKING_GROUP_LABELS,
} from "./queueSettings";

describe("queueSettings", () => {
  it("labels every ranking group", () => {
    for (const g of QUEUE_RANKING_GROUPS) {
      expect(QUEUE_RANKING_GROUP_LABELS[g]).toBeTruthy();
    }
  });

  it("builds a valid row and rejects invalid orders", () => {
    expect(buildQueueRankingRow(["follow_up", "task_due"])).toEqual({
      order: ["follow_up", "task_due"],
    });
    expect(() => buildQueueRankingRow([])).toThrow();
    // duplicate → invalid
    expect(() => buildQueueRankingRow(["follow_up", "follow_up"])).toThrow();
  });

  it("recognizes the shipped default order", () => {
    expect(isDefaultOrder(DEFAULT_QUEUE_RANKING_ORDER)).toBe(true);
    expect(isDefaultOrder(["task_due", "follow_up", "provider_start", "launch_date"])).toBe(false);
    expect(isDefaultOrder(["follow_up"])).toBe(false);
  });

  it("moves groups up/down with clamping", () => {
    const o = ["follow_up", "task_due", "provider_start", "launch_date"] as const;
    expect(moveGroup(o, 1, -1)).toEqual(["task_due", "follow_up", "provider_start", "launch_date"]);
    expect(moveGroup(o, 1, 1)).toEqual(["follow_up", "provider_start", "task_due", "launch_date"]);
    // clamped at edges
    expect(moveGroup(o, 0, -1)).toEqual([...o]);
    expect(moveGroup(o, 3, 1)).toEqual([...o]);
  });
});
