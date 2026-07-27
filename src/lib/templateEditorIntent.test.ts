import { describe, expect, it } from "vitest";
import {
  INTENT_BANNERS,
  TEMPLATE_EDITOR_INTENTS,
  intentStillApplies,
  parseTemplateEditorIntent,
  resolveIntentBanner,
  type IntentStepFacts,
} from "./templateEditorIntent";

const facts = (overrides: Partial<IntentStepFacts>): IntentStepFacts => ({
  hasPortal: false,
  fieldCount: 0,
  brokenCount: 0,
  proven: false,
  ...overrides,
});

describe("parseTemplateEditorIntent", () => {
  it("accepts exactly the five intents", () => {
    for (const intent of TEMPLATE_EDITOR_INTENTS) {
      expect(parseTemplateEditorIntent(intent)).toBe(intent);
    }
  });

  it("rejects unknown values, casing drift, and non-strings", () => {
    expect(parseTemplateEditorIntent("publish")).toBeNull();
    expect(parseTemplateEditorIntent("Register")).toBeNull();
    expect(parseTemplateEditorIntent(1)).toBeNull();
    expect(parseTemplateEditorIntent(undefined)).toBeNull();
    expect(parseTemplateEditorIntent(null)).toBeNull();
  });
});

describe("intentStillApplies — the banner is derived from live step state", () => {
  it("register applies only while no portal is linked", () => {
    expect(intentStillApplies("register", facts({ hasPortal: false }))).toBe(true);
    expect(intentStillApplies("register", facts({ hasPortal: true }))).toBe(false);
  });

  it("capture applies while the portal has zero captured fields", () => {
    expect(intentStillApplies("capture", facts({ hasPortal: true, fieldCount: 0 }))).toBe(true);
    expect(intentStillApplies("capture", facts({ hasPortal: true, fieldCount: 3 }))).toBe(false);
    expect(intentStillApplies("capture", facts({ hasPortal: false }))).toBe(false);
  });

  it("repair applies while any mapping is broken — even on a proven form", () => {
    expect(
      intentStillApplies("repair", facts({ hasPortal: true, fieldCount: 4, brokenCount: 2 })),
    ).toBe(true);
    expect(
      intentStillApplies(
        "repair",
        facts({ hasPortal: true, fieldCount: 4, brokenCount: 1, proven: true }),
      ),
    ).toBe(true);
    expect(intentStillApplies("repair", facts({ hasPortal: true, fieldCount: 4 }))).toBe(false);
  });

  it("train and prove apply while captured fields exist and the form is unproven", () => {
    for (const intent of ["train", "prove"] as const) {
      expect(intentStillApplies(intent, facts({ hasPortal: true, fieldCount: 2 }))).toBe(true);
      expect(
        intentStillApplies(intent, facts({ hasPortal: true, fieldCount: 2, proven: true })),
      ).toBe(false);
      expect(intentStillApplies(intent, facts({ hasPortal: true, fieldCount: 0 }))).toBe(false);
      expect(intentStillApplies(intent, facts({ hasPortal: false, fieldCount: 2 }))).toBe(false);
    }
  });
});

describe("resolveIntentBanner", () => {
  it("returns the intent's banner while the work is outstanding", () => {
    expect(resolveIntentBanner("register", facts({}))).toEqual(INTENT_BANNERS.register);
  });

  it("disappears the moment the work the intent points at is done", () => {
    expect(resolveIntentBanner("register", facts({ hasPortal: true }))).toBeNull();
    expect(
      resolveIntentBanner("prove", facts({ hasPortal: true, fieldCount: 2, proven: true })),
    ).toBeNull();
  });

  it("never renders without an intent or without an online-form step to anchor", () => {
    expect(resolveIntentBanner(null, facts({}))).toBeNull();
    expect(resolveIntentBanner("register", null)).toBeNull();
  });

  it("carries the design copy for every mode", () => {
    expect(INTENT_BANNERS.capture.title).toBe("Waiting on field capture");
    expect(INTENT_BANNERS.train.title).toBe("Map the captured fields");
    expect(INTENT_BANNERS.repair.title).toBe("Repair broken mappings");
    expect(INTENT_BANNERS.prove.title).toBe("Check field coverage");
  });
});
