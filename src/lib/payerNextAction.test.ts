import { describe, expect, it } from "vitest";
import { resolvePayerNextAction } from "@/lib/payerNextAction";
import type { FunnelRow } from "@/lib/payerReadinessFunnel";

function funnel(over: Partial<FunnelRow> = {}): FunnelRow {
  return {
    payerId: "p1",
    payerName: "Aetna",
    sopPublished: true,
    sopCount: 1,
    needsPortal: true,
    formState: "trained",
    portalKey: "aetna",
    sopTemplateId: "t1",
    driftCount: 0,
    nextAction: "ready",
    formSuggestion: "run_dry_test",
    ready: true,
    readyNote: null,
    started: true,
    ...over,
  };
}

describe("resolvePayerNextAction", () => {
  it("asks for a template when none is published", () => {
    const action = resolvePayerNextAction({
      funnel: funnel({ sopPublished: false, nextAction: "author_sop", formSuggestion: null }),
      inNetwork: true,
    });
    expect(action.kind).toBe("author_template");
  });

  it("prefers form ladder over attach when autofill is incomplete", () => {
    const action = resolvePayerNextAction({
      funnel: funnel({ formSuggestion: "repair_drift", driftCount: 2 }),
      inNetwork: false,
    });
    expect(action.kind).toBe("repair_drift");
    expect(action.intent).toBe("repair");
  });

  it("asks to attach when checklist+form are ready but not in network", () => {
    const action = resolvePayerNextAction({
      funnel: funnel({ formSuggestion: null, formState: "proven", needsPortal: true }),
      inNetwork: false,
    });
    expect(action.kind).toBe("attach_group");
  });

  it("reads ready — no online form for paper/email payers in network", () => {
    const action = resolvePayerNextAction({
      funnel: funnel({
        needsPortal: false,
        formSuggestion: null,
        readyNote: "SOP has no online form step — no portal required",
      }),
      inNetwork: true,
    });
    expect(action.kind).toBe("ready_no_form");
    expect(action.label).toContain("no online form");
  });
});
