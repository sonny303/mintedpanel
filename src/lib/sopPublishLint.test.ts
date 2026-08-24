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

  it("accepts a group email token recipient (CC to the group's credentialing inbox)", () => {
    const r = lintSopForPublish(
      emailSop(
        [{ source: "token", token: "provider.email" }],
        [{ source: "token", token: "group.credentialingEmail" }],
      ),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a non-email token recipient (anti-fake-CRM guardrail)", () => {
    const r = lintSopForPublish(emailSop([{ source: "token", token: "payer.name" }]));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /not an email field/.test(e.message))).toBe(true);
  });

  it("rejects a non-email column of an entity it does hold", () => {
    const r = lintSopForPublish(emailSop([{ source: "token", token: "group.name" }]));
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

  // BITE-SOP-TT-01 — Auto-fill ↔ online_form + portalKey.
  it("rejects Auto-fill with no online_form step", () => {
    const r = lintSopForPublish([
      {
        title: "Submit application",
        executionType: "extension_fill",
        steps: [{ label: "Call the payer", stepType: "phone" }],
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /Auto-fill.*online form step/.test(e.message))).toBe(true);
  });

  it("rejects Auto-fill online_form without a portalKey", () => {
    const r = lintSopForPublish([
      {
        title: "Submit application",
        executionType: "extension_fill",
        steps: [{ label: "Fill the portal", stepType: "online_form" }],
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /online form.*needs a portal/.test(e.message))).toBe(true);
  });

  it("rejects Auto-fill online_form with a blank portalKey", () => {
    const r = lintSopForPublish([
      {
        title: "Submit application",
        executionType: "extension_fill",
        steps: [{ label: "Fill the portal", stepType: "online_form", portalKey: "   " }],
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /online form.*needs a portal/.test(e.message))).toBe(true);
  });

  it("accepts Auto-fill with an online_form step and portalKey", () => {
    const r = lintSopForPublish([
      {
        title: "Submit application",
        executionType: "extension_fill",
        steps: [
          { label: "Fill the portal", stepType: "online_form", portalKey: "bcbs_ks_enrollment" },
        ],
      },
    ]);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("does not apply the Auto-fill portal rule to manual tasks", () => {
    const r = lintSopForPublish([
      {
        title: "Submit application",
        executionType: "manual",
        steps: [{ label: "Fill the portal", stepType: "online_form" }],
      },
    ]);
    expect(r.ok).toBe(true);
  });

  it("flags every online_form step missing a portal on an Auto-fill task", () => {
    const r = lintSopForPublish([
      {
        title: "Submit application",
        executionType: "extension_fill",
        steps: [
          { label: "First form", stepType: "online_form", portalKey: "availity" },
          { label: "Second form", stepType: "online_form" },
        ],
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].stepIndex).toBe(2);
    expect(r.errors[0].message).toMatch(/step 2 \(online form\) needs a portal/);
  });
});

describe("Payer PDF steps", () => {
  it("blocks publishing a payer-form action with no form uploaded", () => {
    const r = lintSopForPublish([
      {
        title: "Send payer form",
        steps: [{ label: "Send payer form", stepType: "pdf", payerForm: { familyId: "" } }],
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toMatch(/payer PDF\) needs a form uploaded/);
  });

  it("passes once a form is attached", () => {
    const r = lintSopForPublish([
      {
        title: "Send payer form",
        steps: [{ label: "Send payer form", stepType: "pdf", payerForm: { familyId: "fam-1" } }],
      },
    ]);
    expect(r.ok).toBe(true);
  });

  it("does NOT lint a legacy pdf step — no pointer means a plain step", () => {
    const r = lintSopForPublish([
      { title: "Mail packet", steps: [{ label: "Mail packet", stepType: "pdf" }] },
    ]);
    expect(r.ok).toBe(true);
  });

  // The wizard's initial Create defers ONLY this rule (a brand-new template
  // has no id yet for the form's FK to attach to) — it has to be able to tell
  // this error apart from every other rule to do that.
  it("tags the missing-form error so callers can filter it out from other rules", () => {
    const r = lintSopForPublish([
      {
        title: "Send payer form",
        steps: [
          { label: "New step" }, // an ordinary placeholder-label error, untagged
          { label: "Send payer form", stepType: "pdf", payerForm: { familyId: "" } },
        ],
      },
    ]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.find((e) => /needs a label/.test(e.message))?.rule).toBeUndefined();
    expect(r.errors.find((e) => /payer PDF\) needs a form uploaded/.test(e.message))?.rule).toBe(
      "payer_form_missing",
    );
  });
});
