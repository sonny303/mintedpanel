import { describe, expect, it } from "vitest";
import type { SOPTaskDefinition } from "@/types";
import { lintSopForPublish } from "./sopPublishLint";

function task(title: string, stepLabels: string[]): SOPTaskDefinition {
  return { title, steps: stepLabels.map((label) => ({ label })) };
}

describe("lintSopForPublish", () => {
  it("rejects an SOP with zero tasks", () => {
    const r = lintSopForPublish([]);
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/at least one task/);
  });

  it("rejects a task with zero steps", () => {
    const r = lintSopForPublish([task("Submit application", [])]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /at least one step/.test(e.message))).toBe(true);
  });

  it("rejects blank / default placeholder labels", () => {
    const r = lintSopForPublish([task("New task", ["New step"])]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /needs a name/.test(e.message))).toBe(true);
    expect(r.errors.some((e) => /needs a label/.test(e.message))).toBe(true);
  });

  it("treats whitespace-only labels as placeholders", () => {
    const r = lintSopForPublish([task("  ", ["  "])]);
    expect(r.ok).toBe(false);
  });

  it("passes a real SOP", () => {
    const r = lintSopForPublish([
      task("Prepare CAQH", ["Open CAQH portal", "Attest"]),
      task("Submit application", ["Fill Aetna portal"]),
    ]);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
