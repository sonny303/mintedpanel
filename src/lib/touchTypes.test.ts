import { describe, expect, it } from "vitest";
import {
  CANONICAL_TOUCH_TYPES,
  isInternalTouchType,
  isPayerFacingTouchType,
  TOUCH_TYPE_LABELS,
  touchTypeDirection,
  touchTypeLabel,
} from "./touchTypes";
import {
  DISPOSITION_LABELS,
  dispositionRequiresContext,
  isDisposition,
  TOUCH_DISPOSITIONS,
} from "./touchDispositions";
import { outcomeLabel } from "./touchOutcomes";
import type { TouchType } from "@/types";

describe("touchTypes (F4.1.1)", () => {
  it("exposes the seven fixed E4.1 types in order, with mail kept as legacy", () => {
    expect(CANONICAL_TOUCH_TYPES).toEqual([
      "call",
      "portal",
      "email",
      "fax",
      "caqh_update",
      "provider_outreach",
      "internal_sync",
    ]);
    // mail is a legacy value — valid + labelled, but never offered as a choice.
    expect(CANONICAL_TOUCH_TYPES).not.toContain("mail");
    expect(TOUCH_TYPE_LABELS.mail).toBe("Mail");
  });

  it("labels the new types and renders historical rows unchanged", () => {
    expect(touchTypeLabel("caqh_update")).toBe("CAQH Update");
    expect(touchTypeLabel("provider_outreach")).toBe("Provider Outreach");
    expect(touchTypeLabel("internal_sync")).toBe("Internal Sync");
    // historical / relabelled
    expect(touchTypeLabel("portal")).toBe("Portal Check");
    expect(touchTypeLabel("mail")).toBe("Mail");
    expect(touchTypeLabel(null)).toBe("");
  });

  it("keeps the inward-facing pair distinguishable from payer-facing contact", () => {
    expect(touchTypeDirection("provider_outreach")).toBe("internal");
    expect(touchTypeDirection("internal_sync")).toBe("internal");
    expect(isInternalTouchType("provider_outreach")).toBe(true);
    expect(isInternalTouchType("internal_sync")).toBe(true);
    for (const t of ["call", "portal", "email", "fax", "caqh_update", "mail"] as TouchType[]) {
      expect(touchTypeDirection(t)).toBe("payer_facing");
      expect(isPayerFacingTouchType(t)).toBe(true);
      expect(isInternalTouchType(t)).toBe(false);
    }
  });
});

describe("touchDispositions (F4.1.4)", () => {
  it("is the five-value disposition set mapped onto TouchOutcome", () => {
    expect(TOUCH_DISPOSITIONS.map((d) => d.value)).toEqual([
      "successful",
      "attempted",
      "no_response",
      "error",
      "other",
    ]);
    expect(TOUCH_DISPOSITIONS.map((d) => d.label)).toEqual([
      "Successful",
      "Attempted",
      "No response",
      "Error",
      "Other",
    ]);
  });

  it("requires a context line only for Other", () => {
    expect(dispositionRequiresContext("other")).toBe(true);
    expect(dispositionRequiresContext("successful")).toBe(false);
    expect(dispositionRequiresContext(null)).toBe(false);
  });

  it("recognises disposition codes and folds their labels into outcomeLabel", () => {
    expect(isDisposition("successful")).toBe(true);
    expect(isDisposition("left_voicemail")).toBe(false);
    expect(isDisposition(null)).toBe(false);
    // new labels resolve through the shared outcomeLabel used by rows + CSV
    expect(outcomeLabel("successful")).toBe("Successful");
    expect(outcomeLabel("attempted")).toBe("Attempted");
    expect(outcomeLabel("error")).toBe("Error");
    expect(outcomeLabel("other")).toBe("Other");
    expect(DISPOSITION_LABELS.successful).toBe("Successful");
    // legacy outcome rendering is untouched
    expect(outcomeLabel("left_voicemail")).toBe("Left voicemail");
  });
});
