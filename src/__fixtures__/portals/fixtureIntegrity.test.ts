import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createSyntheticPdfCorpus, type SyntheticPdfCorpus } from "./pdfCorpus";

interface WizardStepFixture {
  file: string;
  stepId: string;
  heading: string;
}

interface FixtureManifest {
  fixtureSet: string;
  synthetic: boolean;
  provenance: string;
  portalOrigin: string;
  wizardUrl: string;
  wizardStepFiles: WizardStepFixture[];
  identityCases: string[];
  specialCases: string[];
  limits: string[];
}

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const contractRoot = path.resolve(fixtureRoot, "../../../docs/ops/portal-pdf-filler-refresh");
const manifest = JSON.parse(
  readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8"),
) as FixtureManifest;

function readFixture(relativePath: string): string {
  return readFileSync(path.join(fixtureRoot, relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFixture(relativePath)) as T;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

async function generateCorpusTwice(): Promise<[SyntheticPdfCorpus, SyntheticPdfCorpus]> {
  return Promise.all([createSyntheticPdfCorpus(), createSyntheticPdfCorpus()]);
}

describe("R0 synthetic portal fixture integrity", () => {
  it("marks all portal fixtures synthetic and pins seven pages to one static URL", () => {
    expect(manifest.fixtureSet).toBe("portal-pdf-refresh-r0");
    expect(manifest.synthetic).toBe(true);
    expect(manifest.provenance).toMatch(/no payer capture/i);
    expect(manifest.portalOrigin).toMatch(/\.invalid$/);
    expect(manifest.wizardStepFiles).toHaveLength(7);

    const seenStepIds = new Set<string>();
    const seenHeadings = new Set<string>();
    for (const [index, step] of manifest.wizardStepFiles.entries()) {
      const html = readFixture(step.file);
      expect(html).toContain(`data-fixture-url="${manifest.wizardUrl}"`);
      expect(html).toContain(`data-trained-anchor="${step.stepId}"`);
      expect(html).toContain(`Page ${index + 1} of 7`);
      expect(html).toContain(`<h2>${step.heading}</h2>`);
      expect(seenStepIds.has(step.stepId)).toBe(false);
      expect(seenHeadings.has(step.heading)).toBe(false);
      seenStepIds.add(step.stepId);
      seenHeadings.add(step.heading);
    }
  });

  it("keeps sequence-only, delayed, and repeated-heading cases distinguishable", () => {
    const unknown = readFixture("static-wizard/page-unknown.html");
    expect(unknown).toContain("Page 4 of 7");
    expect(unknown).not.toContain("data-trained-anchor=");
    expect(unknown).toContain("<h1>Enrollment</h1>");

    const before = readFixture("static-wizard/delayed-before.html");
    const after = readFixture("static-wizard/delayed-after.html");
    expect(before).toContain('aria-busy="true"');
    expect(before).not.toContain("data-trained-anchor=");
    expect(after).toContain('aria-busy="false"');
    expect(after).toContain('data-trained-anchor="credentials"');

    const hidden = readFixture("static-wizard/hidden-inactive-panel.html");
    expect(hidden).toContain(`data-fixture-url="${manifest.wizardUrl}"`);
    expect(hidden).toContain('data-active-panel="organization"');
    expect(hidden).toContain('<section hidden data-inactive-panel="credentials">');
    expect(hidden).toContain('id="hidden-license"');

    const repeated = readFixture("static-wizard/duplicate-headings.html");
    expect(repeated.match(/<h2>Application Details<\/h2>/g)).toHaveLength(2);
    expect(repeated).toContain('data-trained-anchor="organization"');
  });

  it("pins duplicate labels across separate synthetic frames", () => {
    const parent = readFixture("static-wizard/frames/parent.html");
    const frameA = readFixture("static-wizard/frames/frame-a.html");
    const frameB = readFixture("static-wizard/frames/frame-b.html");
    expect(parent).toContain('src="frame-a.html"');
    expect(parent).toContain('src="frame-b.html"');
    expect(frameA.match(/Service State/g)).toHaveLength(1);
    expect(frameB.match(/Service State/g)).toHaveLength(1);
    expect(frameA).toContain('id="group-state"');
    expect(frameB).toContain('id="provider-state"');
  });

  it("records the date mask reversion as synthetic failure evidence only", () => {
    const fixture = readJson<{
      synthetic: boolean;
      notPayerEvidence: boolean;
      attempt: { value: string };
      settled: { value: string };
      expectedOutcome: string;
      reasonCode: string;
      telemetryRule: string;
    }>("date-mask-reversion.json");
    expect(fixture.synthetic).toBe(true);
    expect(fixture.notPayerEvidence).toBe(true);
    expect(fixture.attempt.value).toBe("02/02/1980");
    expect(fixture.settled.value).toBe("02/02/6100");
    expect(fixture.expectedOutcome).toBe("write_rejected");
    expect(fixture.reasonCode).toBe("mask_reverted");
    expect(fixture.telemetryRule).toMatch(/stores neither value/i);
  });

  it("labels the identifier patterns as illustrative, not as Optum requirements", () => {
    const fixture = readJson<{
      synthetic: boolean;
      notPayerEvidence: boolean;
      label: string;
      fields: Array<{ fieldKey: string; pattern: string; example: string; ruleSource: string }>;
    }>("identifier-constraints.json");
    expect(fixture.synthetic).toBe(true);
    expect(fixture.notPayerEvidence).toBe(true);
    expect(fixture.label).toMatch(/not observed portal behavior/i);
    expect(fixture.fields).toHaveLength(2);
    for (const field of fixture.fields) {
      expect(new RegExp(field.pattern).test(field.example)).toBe(true);
      expect(field.ruleSource).toMatch(/synthetic fixture design/i);
    }
    expect(fixture.fields[0].example.split(" ").every((value) => /^\d{10}$/.test(value))).toBe(
      true,
    );
  });

  it("pins the frozen V2 metadata schema without expected, actual, or raw value properties", () => {
    const schema = JSON.parse(
      readFileSync(path.join(contractRoot, "fill-event-v2.schema.json"), "utf8"),
    ) as {
      properties: Record<string, unknown>;
      required: string[];
      title: string;
      description: string;
    } & {
      properties: {
        schemaVersion: { const: number };
      };
      $defs: { fieldOutcome: { properties: Record<string, unknown> } };
    };
    const v2Keys = [
      ...Object.keys(schema.properties),
      ...Object.keys(schema.$defs.fieldOutcome.properties),
    ];
    expect(schema.properties.schemaVersion.const).toBe(2);
    expect(schema.title).toMatch(/fill event v2 metadata/i);
    expect(schema.description).toMatch(/value-free/i);
    expect(schema.$defs.fieldOutcome.properties.outcome).toBeDefined();
    expect(v2Keys).not.toContain("expectedValue");
    expect(v2Keys).not.toContain("actualValue");
    expect(v2Keys).not.toContain("value");
    expect(v2Keys).not.toContain("reason");
  });
});

describe("R0 generated PDF corpus", () => {
  it("creates repeatable AcroForm, flat, and marker-only XFA documents", async () => {
    const [first, second] = await generateCorpusTwice();
    expect(bytesEqual(first.acroForm, second.acroForm)).toBe(true);
    expect(bytesEqual(first.flat, second.flat)).toBe(true);
    expect(bytesEqual(first.xfaMarker, second.xfaMarker)).toBe(true);

    const acro = await PDFDocument.load(first.acroForm);
    const form = acro.getForm();
    expect(form.getTextField("synthetic.text").getText()).toBe("fixture-text");
    expect(form.getCheckBox("synthetic.checkbox").isChecked()).toBe(true);
    expect(form.getRadioGroup("synthetic.radio").getSelected()).toBe("choice-a");
    expect(form.getDropdown("synthetic.dropdown").getSelected()).toEqual(["choice-a"]);
    expect(form.getOptionList("synthetic.option-list").getSelected()).toEqual(["choice-a"]);

    const flat = await PDFDocument.load(first.flat);
    expect(flat.getForm().getFields()).toHaveLength(0);

    const xfaMarker = Buffer.from(first.xfaMarker).toString("latin1");
    expect(xfaMarker).toContain("/XFA");
    expect(xfaMarker).toContain("R0-XFA-MARKER-ONLY-NOT-A-FORM");
    expect(manifest.limits.join(" ")).toMatch(/dictionary marker only/i);
  });

  it("does not claim to generate cryptographically signed or encrypted PDFs", async () => {
    const corpus = await createSyntheticPdfCorpus();
    for (const unavailable of Object.values(corpus.unavailableClasses)) {
      expect(unavailable.generated).toBe(false);
      expect(unavailable.status).toBe("external-valid-sample-required");
      expect(unavailable.reason).toMatch(/cryptographically valid/i);
    }
  });
});
