// Payer PDF — the pure rules. What is worth pinning here is the FAMILY/ROW
// split (a template action points at a family, a case task at a row), the
// derived "current" rule, and the fact that a removed action disappears from
// the checklist while staying on the row.
import { describe, expect, it } from "vitest";
import {
  currentPayerFormInFamily,
  currentPayerForms,
  hydratePayerFormTasks,
  isPayerFormRemoved,
  isPayerFormStep,
  markPayerFormRemoved,
  nextPayerFormVersion,
  payerFormDisplayName,
  payerFormFileError,
  payerFormLabelError,
  payerFormObjectPath,
  payerFormPointer,
  payerFormsByFamily,
  splitPayerFormActions,
  taskPayerFormPointer,
  PAYER_FORM_MAX_BYTES,
} from "@/lib/payerForms";

function form(
  over: Partial<{ id: string; familyId: string; version: number; retiredAt: string | null }> = {},
) {
  return {
    id: over.id ?? "f1",
    familyId: over.familyId ?? "fam-1",
    version: over.version ?? 1,
    retiredAt: over.retiredAt ?? null,
    label: "PT Credentialing Supplement",
    fileName: "supplement.pdf",
  };
}

describe("payer form storage path", () => {
  it("is org-free and sanitizes the file name", () => {
    expect(
      payerFormObjectPath({
        payerId: "payer-1",
        familyId: "fam-1",
        version: 2,
        fileName: "PT Supplement (2024) FINAL.pdf",
      }),
    ).toBe("payer/payer-1/fam-1/2/PT_Supplement_2024_FINAL.pdf");
  });
});

describe("current version derivation", () => {
  it("takes the highest version per family", () => {
    const rows = [
      form({ id: "a", version: 1 }),
      form({ id: "b", version: 3 }),
      form({ id: "c", version: 2 }),
    ];
    expect(currentPayerForms(rows).map((r) => r.id)).toEqual(["b"]);
  });

  it("drops a family whose CURRENT version is retired", () => {
    const rows = [
      form({ id: "a", version: 1 }),
      form({ id: "b", version: 2, retiredAt: "2026-08-01T00:00:00Z" }),
    ];
    expect(currentPayerForms(rows)).toEqual([]);
    expect(currentPayerFormInFamily(rows, "fam-1")).toBeNull();
  });

  it("keeps a family whose OLDER version is retired — that is just history", () => {
    const rows = [
      form({ id: "a", version: 1, retiredAt: "2026-07-01T00:00:00Z" }),
      form({ id: "b", version: 2 }),
    ];
    expect(currentPayerForms(rows).map((r) => r.id)).toEqual(["b"]);
  });

  it("versions each family independently", () => {
    const rows = [
      form({ id: "a", familyId: "fam-1", version: 2 }),
      form({ id: "b", familyId: "fam-2", version: 1 }),
    ];
    expect(new Set(currentPayerForms(rows).map((r) => r.id))).toEqual(new Set(["a", "b"]));
    expect(nextPayerFormVersion(rows.filter((r) => r.familyId === "fam-1"))).toBe(3);
    expect(nextPayerFormVersion([])).toBe(1);
  });
});

describe("upload validation", () => {
  it("requires a label and caps its length", () => {
    expect(payerFormLabelError("")).toBeTruthy();
    expect(payerFormLabelError("   ")).toBeTruthy();
    expect(payerFormLabelError("PT Credentialing Supplement")).toBeNull();
    expect(payerFormLabelError("x".repeat(200))).toBeTruthy();
  });

  it("accepts only non-empty PDFs within the size cap", () => {
    expect(payerFormFileError({ size: 100, type: "application/pdf" })).toBeNull();
    expect(payerFormFileError({ size: 100, type: "image/png" })).toBeTruthy();
    expect(payerFormFileError({ size: 0, type: "application/pdf" })).toBeTruthy();
    expect(
      payerFormFileError({ size: PAYER_FORM_MAX_BYTES + 1, type: "application/pdf" }),
    ).toBeTruthy();
  });
});

describe("step pointer", () => {
  const resolved = {
    id: "s1",
    label: "Send payer form",
    stepType: "pdf",
    payerForm: { familyId: "fam-1", formId: "f1", label: "Supplement", fileName: "s.pdf" },
  };

  it("reads a resolved pointer", () => {
    expect(payerFormPointer(resolved)?.formId).toBe("f1");
    expect(isPayerFormStep(resolved)).toBe(true);
  });

  it("treats a LEGACY pdf step (no pointer) as an ordinary step", () => {
    const legacy = { id: "s1", label: "Mail the packet", stepType: "pdf" };
    expect(payerFormPointer(legacy)).toBeNull();
    expect(isPayerFormStep(legacy)).toBe(false);
  });

  it("treats an authored-but-unfilled pointer as no form", () => {
    // familyId "" is the "file not chosen yet" state the publish lint rejects;
    // nothing downstream may act on it.
    const unfilled = {
      id: "s1",
      label: "Send payer form",
      stepType: "pdf",
      payerForm: { familyId: "" },
    };
    expect(payerFormPointer(unfilled)).toBeNull();
    expect(isPayerFormStep(unfilled)).toBe(false);
  });

  it("survives malformed jsonb without throwing", () => {
    expect(payerFormPointer(null)).toBeNull();
    expect(payerFormPointer("nope")).toBeNull();
    expect(taskPayerFormPointer(null)).toBeNull();
    expect(taskPayerFormPointer({ not: "an array" })).toBeNull();
  });

  it("falls back through label → file name → generic", () => {
    expect(
      payerFormDisplayName({ familyId: "f", formId: "i", label: "A", fileName: "b.pdf" }),
    ).toBe("A");
    expect(payerFormDisplayName({ familyId: "f", formId: "i", label: "", fileName: "b.pdf" })).toBe(
      "b.pdf",
    );
    expect(payerFormDisplayName({ familyId: "f", formId: "i", label: "", fileName: "" })).toBe(
      "Payer form",
    );
  });
});

describe("generation hydration", () => {
  const definitions = [
    { steps: [{ stepType: "online_form", portalKey: "bcbs" }] },
    { steps: [{ stepType: "pdf", payerForm: { familyId: "fam-1" } }] },
  ];
  const tasks = [
    { title: "Fill online form", sopContent: [{ id: "s1", label: "Fill online form" }] },
    {
      title: "Send payer form",
      sopContent: [{ id: "s2", label: "Send payer form", stepType: "pdf" }],
    },
  ];

  it("bakes the family's CURRENT row onto the payer-form task", () => {
    const out = hydratePayerFormTasks(
      tasks,
      definitions,
      payerFormsByFamily([{ id: "f9", familyId: "fam-1", label: "Supplement", fileName: "s.pdf" }]),
    );
    expect(out).toHaveLength(2);
    const pointer = taskPayerFormPointer(out[1].sopContent);
    expect(pointer).toMatchObject({ familyId: "fam-1", formId: "f9", label: "Supplement" });
  });

  it("leaves non-payer-form tasks untouched", () => {
    const out = hydratePayerFormTasks(
      tasks,
      definitions,
      payerFormsByFamily([{ id: "f9", familyId: "fam-1", label: "Supplement", fileName: "s.pdf" }]),
    );
    expect(out[0]).toBe(tasks[0]);
  });

  it("DROPS the action when the family has no live form", () => {
    // Retiring a form means "stop putting this on new cases" — a checklist item
    // with nothing to download would be worse than no item.
    const out = hydratePayerFormTasks(tasks, definitions, payerFormsByFamily([]));
    expect(out.map((t) => t.title)).toEqual(["Fill online form"]);
  });
});

describe("removal", () => {
  const steps = [
    {
      id: "s1",
      label: "Send payer form",
      stepType: "pdf",
      payerForm: { familyId: "fam-1", formId: "f1", label: "Supplement", fileName: "s.pdf" },
    },
  ];

  it("appends the marker without touching anything else", () => {
    const next = markPayerFormRemoved(steps, {
      removedAt: "2026-08-24T10:00:00Z",
      removedBy: "user-1",
      removedReason: "Not required for this provider",
    });
    const pointer = taskPayerFormPointer(next);
    expect(pointer?.removedAt).toBe("2026-08-24T10:00:00Z");
    // The form it pointed at is preserved — the record of WHICH form was
    // removed is the whole point of appending rather than clearing.
    expect(pointer?.formId).toBe("f1");
    expect((next[0] as { label: string }).label).toBe("Send payer form");
    expect(isPayerFormRemoved(next)).toBe(true);
    expect(isPayerFormRemoved(steps)).toBe(false);
  });

  it("splits a case's tasks into live payer forms, other work, and removed", () => {
    const removedSteps = markPayerFormRemoved(steps, {
      removedAt: "2026-08-24T10:00:00Z",
      removedBy: null,
      removedReason: null,
    });
    const { payerForms, rest, removed } = splitPayerFormActions([
      {
        id: "t1",
        title: "Fill form",
        status: "not_started",
        sopContent: [{ id: "a", label: "x" }],
      },
      { id: "t2", title: "Send payer form", status: "not_started", sopContent: steps },
      { id: "t3", title: "Send other form", status: "blocked", sopContent: removedSteps },
    ]);
    expect(payerForms.map((p) => p.taskId)).toEqual(["t2"]);
    expect(rest.map((r) => r.id)).toEqual(["t1"]);
    expect(removed.map((r) => r.id)).toEqual(["t3"]);
  });
});
