import { describe, it, expect } from "vitest";
import { planStepCompletion, stepCompletionPatch } from "./sopStepCompletion";
import type { SOPStep } from "@/types";

function step(id: string, order: number, isCompleted = false): SOPStep {
  return { id, order, label: `Step ${id}`, isCompleted } as SOPStep;
}

const NOW = "2026-07-28T10:00:00.000Z";

describe("planStepCompletion", () => {
  it("ticks a step and stamps the actor + time", () => {
    const plan = planStepCompletion([step("a", 1), step("b", 2)], "a", "u1", NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const a = plan.nextSteps.find((s) => s.id === "a");
    expect(a?.isCompleted).toBe(true);
    expect(a?.completedAt).toBe(NOW);
    expect(a?.completedBy).toBe("u1");
    // Untouched steps are carried through unchanged.
    expect(plan.nextSteps.find((s) => s.id === "b")?.isCompleted).toBe(false);
  });

  it("blocks a step whose earlier sibling is incomplete, naming the blocker", () => {
    const plan = planStepCompletion([step("a", 1), step("b", 2)], "b", "u1", NOW);
    expect(plan).toEqual({ ok: false, reason: "blocked", blockedBy: "Step a" });
  });

  it("checks ORDER, not array position — a reordered payload can't skip the rule", () => {
    // b (order 2) listed first must still be blocked by a (order 1).
    const plan = planStepCompletion([step("b", 2), step("a", 1)], "b", "u1", NOW);
    expect(plan).toEqual({ ok: false, reason: "blocked", blockedBy: "Step a" });
  });

  it("allows a later step once the earlier one is done", () => {
    const plan = planStepCompletion([step("a", 1, true), step("b", 2)], "b", "u1", NOW);
    expect(plan.ok).toBe(true);
  });

  it("reports allDone only when every step is complete", () => {
    const partial = planStepCompletion([step("a", 1), step("b", 2)], "a", "u1", NOW);
    expect(partial.ok && partial.allDone).toBe(false);
    const last = planStepCompletion([step("a", 1, true), step("b", 2)], "b", "u1", NOW);
    expect(last.ok && last.allDone).toBe(true);
  });

  it("returns not_found for an unknown step id", () => {
    expect(planStepCompletion([step("a", 1)], "zzz", "u1", NOW)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("tolerates a null actor (a service-role caller has no auth.uid())", () => {
    const plan = planStepCompletion([step("a", 1)], "a", null, NOW);
    expect(plan.ok && plan.nextSteps[0].completedBy).toBeNull();
  });
});

describe("stepCompletionPatch", () => {
  const done = planStepCompletion([step("a", 1, true), step("b", 2)], "b", "u1", NOW);
  const partial = planStepCompletion([step("a", 1), step("b", 2)], "a", "u1", NOW);

  it("completes the task and dates it when every step is done", () => {
    if (!done.ok) throw new Error("expected ok");
    const patch = stepCompletionPatch(done, "in_progress", NOW);
    expect(patch.status).toBe("completed");
    expect(patch.completed_date).toBe("2026-07-28");
    expect(patch.sop_content).toBe(done.nextSteps);
  });

  it("moves a not_started task to in_progress on the first tick", () => {
    if (!partial.ok) throw new Error("expected ok");
    expect(stepCompletionPatch(partial, "not_started", NOW).status).toBe("in_progress");
  });

  it("leaves an in_progress task's status alone mid-way", () => {
    if (!partial.ok) throw new Error("expected ok");
    expect(stepCompletionPatch(partial, "in_progress", NOW).status).toBeUndefined();
  });
});
