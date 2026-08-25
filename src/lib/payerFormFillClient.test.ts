// E6.11 handoff, coverage gap #5 — payerFormFillClient.ts had no test. This
// pins option matching (exact, case/space-insensitive, unmatched) and
// checkbox coercion against a REAL generated AcroForm, via the split-out
// `fillPayerFormBytes` (pdf-lib only, no DOM — `triggerDownload` is the only
// browser-only part, and it stays untested here on purpose).
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { fillPayerFormBytes } from "@/lib/payerFormFillClient";
import type { PayerFormFillEntry, PayerFormFillPlan } from "@/lib/payerFormFill";

const PAGE_OPTS = { x: 0, y: 0, width: 100, height: 20 };

/** A tiny blank AcroForm: one field of each kind this fill engine handles,
 * plus a pushbutton (nothing to fill) and a text field left off the plan
 * (selector the plan never mentions must never be touched). */
async function buildFixtureForm(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();

  const npi = form.createTextField("Npi");
  npi.addToPage(page, PAGE_OPTS);

  const state = form.createDropdown("State");
  state.addOptions(["NC", "SC", "VA"]);
  state.addToPage(page, PAGE_OPTS);

  const region = form.createRadioGroup("Region");
  region.addOptionToPage("East", page, PAGE_OPTS);
  region.addOptionToPage("West", page, PAGE_OPTS);

  const attest = form.createCheckBox("Attest");
  attest.addToPage(page, PAGE_OPTS);

  const submit = form.createButton("Submit");
  submit.addToPage("Submit", page, PAGE_OPTS);

  form.createTextField("Untouched").addToPage(page, PAGE_OPTS);

  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const entry = (over: Partial<PayerFormFillEntry> & { selector: string }): PayerFormFillEntry => ({
  label: over.selector,
  token: null,
  value: null,
  outcome: "token",
  fieldType: null,
  controlOptions: null,
  ...over,
});

const plan = (fill: PayerFormFillEntry[]): PayerFormFillPlan => ({
  fill,
  entries: fill,
  fieldsFilled: fill.length,
  fieldsSkipped: [],
  manualLabels: [],
});

describe("fillPayerFormBytes", () => {
  it("fills a text field with the resolved value", async () => {
    const bytes = await buildFixtureForm();
    const result = await fillPayerFormBytes(
      bytes,
      plan([entry({ selector: "Npi", value: "1999999984", label: "NPI" })]),
    );
    expect(result.written).toBe(1);
    expect(result.rejected).toEqual([]);

    const saved = await PDFDocument.load(result.output);
    expect(saved.getForm().getTextField("Npi").getText()).toBe("1999999984");
  });

  it("matches a dropdown option case/space-insensitively", async () => {
    const bytes = await buildFixtureForm();
    const result = await fillPayerFormBytes(
      bytes,
      plan([entry({ selector: "State", value: " nc ", label: "State" })]),
    );
    expect(result.written).toBe(1);

    const saved = await PDFDocument.load(result.output);
    expect(saved.getForm().getDropdown("State").getSelected()).toEqual(["NC"]);
  });

  it("rejects a dropdown value not in the payer's option list, without throwing", async () => {
    const bytes = await buildFixtureForm();
    const result = await fillPayerFormBytes(
      bytes,
      plan([entry({ selector: "State", value: "ZZ", label: "State" })]),
    );
    expect(result.written).toBe(0);
    expect(result.rejected).toEqual(["State"]);
  });

  it("matches a radio group option the same way a dropdown does", async () => {
    const bytes = await buildFixtureForm();
    const result = await fillPayerFormBytes(
      bytes,
      plan([entry({ selector: "Region", value: "east", label: "Region" })]),
    );
    expect(result.written).toBe(1);

    const saved = await PDFDocument.load(result.output);
    expect(saved.getForm().getRadioGroup("Region").getSelected()).toBe("East");
  });

  it.each([
    ["yes", true],
    ["Y", true],
    ["x", true],
    ["1", true],
    ["no", false],
    ["", false],
  ])("coerces checkbox value %j to checked=%s", async (value, checked) => {
    const bytes = await buildFixtureForm();
    const result = await fillPayerFormBytes(
      bytes,
      plan([entry({ selector: "Attest", value, label: "Attest" })]),
    );
    expect(result.written).toBe(1);

    const saved = await PDFDocument.load(result.output);
    expect(saved.getForm().getCheckBox("Attest").isChecked()).toBe(checked);
  });

  it("rejects a field type it cannot fill (a pushbutton) rather than throwing", async () => {
    const bytes = await buildFixtureForm();
    const result = await fillPayerFormBytes(
      bytes,
      plan([entry({ selector: "Submit", value: "anything", label: "Submit" })]),
    );
    expect(result.written).toBe(0);
    expect(result.rejected).toEqual(["Submit"]);
  });

  it("rejects a selector the form doesn't have, without aborting the rest of the fill", async () => {
    const bytes = await buildFixtureForm();
    const result = await fillPayerFormBytes(
      bytes,
      plan([
        entry({ selector: "DoesNotExist", value: "x", label: "Ghost field" }),
        entry({ selector: "Npi", value: "123", label: "NPI" }),
      ]),
    );
    expect(result.written).toBe(1);
    expect(result.rejected).toEqual(["Ghost field"]);

    const saved = await PDFDocument.load(result.output);
    expect(saved.getForm().getTextField("Npi").getText()).toBe("123");
  });

  it("never touches a field the plan doesn't mention", async () => {
    const bytes = await buildFixtureForm();
    const result = await fillPayerFormBytes(
      bytes,
      plan([entry({ selector: "Npi", value: "123", label: "NPI" })]),
    );
    const saved = await PDFDocument.load(result.output);
    expect(saved.getForm().getTextField("Untouched").getText()).toBeUndefined();
  });
});
