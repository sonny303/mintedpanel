import { describe, expect, it } from "vitest";
import { createFillRunGuard } from "@/lib/fillRunGuard";

describe("fill run context guard", () => {
  it("invalidates a run when the owner leaves and later returns to the same context", () => {
    const guard = createFillRunGuard("case-a:form-a");
    const run = guard.capture();

    guard.setContext("case-b:form-b");
    guard.setContext("case-a:form-a");

    expect(guard.isCurrent(run)).toBe(false);
  });

  it("invalidates a run when its owner unmounts", () => {
    const guard = createFillRunGuard("case-a:form-a");
    const run = guard.capture();

    guard.invalidate();
    guard.activate();

    expect(guard.isCurrent(run)).toBe(false);
  });
});
