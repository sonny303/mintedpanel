import { describe, expect, it } from "vitest";
import type { SOPEmailRecipient, SOPTaskDefinition } from "@/types";
import { lintSopForPublish } from "./sopPublishLint";

function task(title: string, stepLabels: string[]): SOPTaskDefinition {
  return { title, steps: stepLabels.map((label) => ({ label })) };
}

// A single-task SOP whose one step is a draft-email step with the given
// recipients — for the E1.7b F1.7b.5 recipient rule.
function emailSop(to?: SOPEmailRecipient[], cc?: SOPEmailRecipient[]): SOPTaskDefinition[] {
  return [
    {
      title: "Draft the application email",
      steps: [
        {
          label: "Draft email",
          stepType: "draft_email",
          emailTemplate: { subject: "s", body: "b", ...(to ? { to } : {}), ...(cc ? { cc } : {}) },
        },
      ],
    },
  ];
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

  // E1.7b F1.7b.5 (TE-16) — draft-email recipient rule.
  it("rejects a draft-email step with no To recipient", () => {
    const r = lintSopForPublish(emailSop());
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /at least one "To" recipient/.test(e.message))).toBe(true);
  });

  it("accepts a literal To recipient", () => {
    const r = lintSopForPublish(emailSop([{ source: "literal", address: "payer@example.com" }]));
    expect(r.ok).toBe(true);
  });

  it("accepts the provider.email token recipient (valid before generation)", () => {
    const r = lintSopForPublish(emailSop([{ source: "token", token: "provider.email" }]));
    expect(r.ok).toBe(true);
  });

  it("rejects an invalid literal recipient address", () => {
    const r = lintSopForPublish(emailSop([{ source: "literal", address: "not-an-email" }]));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /invalid recipient email/.test(e.message))).toBe(true);
  });

  it("rejects a non-email token recipient (anti-fake-CRM guardrail)", () => {
    const r = lintSopForPublish(emailSop([{ source: "token", token: "payer.name" }]));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /not an email field/.test(e.message))).toBe(true);
  });

  it("validates CC recipients too (valid To, invalid CC literal)", () => {
    const r = lintSopForPublish(
      emailSop(
        [{ source: "literal", address: "payer@example.com" }],
        [{ source: "literal", address: "bad" }],
      ),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /invalid recipient email/.test(e.message))).toBe(true);
  });

  it("does not apply the recipient rule to non-draft-email steps", () => {
    const r = lintSopForPublish([task("Portal work", ["Fill the portal"])]);
    expect(r.ok).toBe(true);
  });
});
