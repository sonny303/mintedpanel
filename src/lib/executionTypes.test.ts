import { describe, expect, it } from "vitest";
import {
  AUTHORING_EXECUTION_TYPES,
  DEFAULT_EXECUTION_TYPE,
  EXECUTION_TYPES,
  EXECUTION_TYPE_LABELS,
  INERT_EXECUTION_TYPES,
  authoringExecutionTypeOptions,
  executionTypeForStorage,
  hasExtensionFillTask,
  hasOnlineFormStep,
  isExecutionType,
  needsFormFollowUp,
  resolveExecutionType,
} from "./executionTypes";

describe("executionTypes", () => {
  it("has a label for every type and a manual default", () => {
    expect(DEFAULT_EXECUTION_TYPE).toBe("manual");
    for (const t of EXECUTION_TYPES) {
      expect(EXECUTION_TYPE_LABELS[t]).toBeTruthy();
    }
    expect(EXECUTION_TYPES).toEqual(["manual", "extension_fill", "auto_verify", "document_attach"]);
  });

  it("keeps full EXECUTION_TYPES for reads while authoring is Manual + Auto-fill only", () => {
    expect(AUTHORING_EXECUTION_TYPES).toEqual(["manual", "extension_fill"]);
    expect(INERT_EXECUTION_TYPES).toEqual(["auto_verify", "document_attach"]);
    // Wire values stay on the full set — never deleted from the union.
    for (const t of INERT_EXECUTION_TYPES) {
      expect(EXECUTION_TYPES).toContain(t);
      expect(isExecutionType(t)).toBe(true);
    }
  });

  it("authoring picker hides inert types unless the task already has one", () => {
    expect(authoringExecutionTypeOptions("manual")).toEqual(["manual", "extension_fill"]);
    expect(authoringExecutionTypeOptions("extension_fill")).toEqual([
      "manual",
      "extension_fill",
    ]);
    expect(authoringExecutionTypeOptions(null)).toEqual(["manual", "extension_fill"]);
    expect(authoringExecutionTypeOptions("auto_verify")).toEqual([
      "manual",
      "extension_fill",
      "auto_verify",
    ]);
    expect(authoringExecutionTypeOptions("document_attach")).toEqual([
      "manual",
      "extension_fill",
      "document_attach",
    ]);
    // Bogus / absent resolves to manual → no inert offered.
    expect(authoringExecutionTypeOptions("bogus")).toEqual(["manual", "extension_fill"]);
  });

  it("guards and resolves raw values", () => {
    expect(isExecutionType("extension_fill")).toBe(true);
    expect(isExecutionType("nonsense")).toBe(false);
    expect(isExecutionType(null)).toBe(false);
    expect(resolveExecutionType(null)).toBe("manual");
    expect(resolveExecutionType("auto_verify")).toBe("auto_verify");
    expect(resolveExecutionType("bogus")).toBe("manual");
  });

  it("stores manual as null (implicit default) and non-manual verbatim", () => {
    expect(executionTypeForStorage("manual")).toBeNull();
    expect(executionTypeForStorage(null)).toBeNull();
    expect(executionTypeForStorage(undefined)).toBeNull();
    expect(executionTypeForStorage("extension_fill")).toBe("extension_fill");
    expect(executionTypeForStorage("bogus")).toBeNull();
  });

  it("detects extension_fill tasks for form-readiness (TE-16)", () => {
    expect(hasExtensionFillTask([{ executionType: "manual" }, { executionType: null }])).toBe(
      false,
    );
    expect(
      hasExtensionFillTask([{ executionType: "manual" }, { executionType: "extension_fill" }]),
    ).toBe(true);
    expect(hasExtensionFillTask([])).toBe(false);
    // absent executionType defaults to manual, so not extension_fill
    expect(hasExtensionFillTask([{}])).toBe(false);
  });

  it("detects online_form steps", () => {
    expect(hasOnlineFormStep([{ steps: [{ stepType: "fax" }] }])).toBe(false);
    expect(hasOnlineFormStep([{ steps: [{ stepType: "online_form" }] }])).toBe(true);
    expect(hasOnlineFormStep([{ steps: undefined }])).toBe(false);
    expect(hasOnlineFormStep([])).toBe(false);
  });

  // BITE-SOP-TT-01 — needsFormFollowUp = hasExtensionFillTask OR hasOnlineForm.
  it("needsFormFollowUp is true for Auto-fill alone, online_form alone, or both", () => {
    expect(
      needsFormFollowUp([{ executionType: "extension_fill", steps: [{ stepType: "phone" }] }]),
    ).toBe(true);
    expect(needsFormFollowUp([{ executionType: "manual", steps: [{ stepType: "online_form" }] }])).toBe(
      true,
    );
    expect(
      needsFormFollowUp([
        {
          executionType: "extension_fill",
          steps: [{ stepType: "online_form" }],
        },
      ]),
    ).toBe(true);
    expect(needsFormFollowUp([{ executionType: "manual", steps: [{ stepType: "fax" }] }])).toBe(
      false,
    );
    expect(needsFormFollowUp([])).toBe(false);
  });
});
