import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface UnsupportedGeneratedPdfClass {
  generated: false;
  status: "external-valid-sample-required";
  reason: string;
}

export interface SyntheticPdfCorpus {
  acroForm: Uint8Array;
  flat: Uint8Array;
  xfaMarker: Uint8Array;
  unavailableClasses: {
    signed: UnsupportedGeneratedPdfClass;
    encrypted: UnsupportedGeneratedPdfClass;
  };
}

const FIXED_DATE = new Date("2000-01-01T00:00:00.000Z");
const FIXTURE_NOTE = "Synthetic R0 PDF fixture. Contains no provider or payer data.";
const SAVE_OPTIONS = { useObjectStreams: false, addDefaultPage: false } as const;

function setStableMetadata(document: PDFDocument, title: string): void {
  document.setTitle(title);
  document.setAuthor("Minted synthetic fixture generator");
  document.setSubject(FIXTURE_NOTE);
  document.setCreator("Minted R0 fixture factory");
  document.setProducer("Minted R0 fixture factory");
  document.setCreationDate(FIXED_DATE);
  document.setModificationDate(FIXED_DATE);
}

export async function createAcroFormFixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  setStableMetadata(document, "Synthetic AcroForm controls");
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(FIXTURE_NOTE, { x: 40, y: 750, size: 9, font, color: rgb(0.2, 0.2, 0.2) });

  const form = document.getForm();
  const text = form.createTextField("synthetic.text");
  text.setText("fixture-text");
  text.addToPage(page, { x: 40, y: 690, width: 220, height: 24, font });

  const checkbox = form.createCheckBox("synthetic.checkbox");
  checkbox.check();
  checkbox.addToPage(page, { x: 40, y: 640, width: 18, height: 18 });

  const radio = form.createRadioGroup("synthetic.radio");
  radio.addOptionToPage("choice-a", page, { x: 40, y: 590, width: 18, height: 18 });
  radio.addOptionToPage("choice-b", page, { x: 80, y: 590, width: 18, height: 18 });
  radio.select("choice-a");

  const dropdown = form.createDropdown("synthetic.dropdown");
  dropdown.setOptions(["choice-a", "choice-b"]);
  dropdown.select("choice-a");
  dropdown.addToPage(page, { x: 40, y: 540, width: 220, height: 24, font });

  const optionList = form.createOptionList("synthetic.option-list");
  optionList.setOptions(["choice-a", "choice-b"]);
  optionList.select("choice-a");
  optionList.addToPage(page, { x: 300, y: 570, width: 220, height: 50, font });

  form.updateFieldAppearances(font);
  return document.save(SAVE_OPTIONS);
}

export async function createFlatFixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  setStableMetadata(document, "Synthetic flat document");
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(FIXTURE_NOTE, { x: 40, y: 750, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("Printed-only synthetic field: __________________", {
    x: 40,
    y: 690,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  });
  return document.save(SAVE_OPTIONS);
}

export async function createXfaMarkerFixture(): Promise<Uint8Array> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm 4 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>",
    "<< /Fields [] /XFA (R0-XFA-MARKER-ONLY-NOT-A-FORM) >>",
    "<< /Producer (Minted R0 fixture factory) >>",
  ];
  const chunks = [Buffer.from("%PDF-1.7\n%R0 synthetic marker-only fixture\n", "ascii")];
  const offsets = [0];
  let byteLength = chunks[0].byteLength;
  for (const [index, body] of objects.entries()) {
    offsets.push(byteLength);
    const object = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, "ascii");
    chunks.push(object);
    byteLength += object.byteLength;
  }
  const xrefOffset = byteLength;
  const xref = ["xref\n0 6\n0000000000 65535 f \n"];
  for (const offset of offsets.slice(1)) {
    xref.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  xref.push(`trailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(Buffer.from(xref.join(""), "ascii"));
  return new Uint8Array(Buffer.concat(chunks));
}

export async function createSyntheticPdfCorpus(): Promise<SyntheticPdfCorpus> {
  const unsupportedReason =
    "The local fixture factory cannot create a cryptographically valid sample; add only a separately sourced, authorized blank fixture.";
  return {
    acroForm: await createAcroFormFixture(),
    flat: await createFlatFixture(),
    xfaMarker: await createXfaMarkerFixture(),
    unavailableClasses: {
      signed: {
        generated: false,
        status: "external-valid-sample-required",
        reason: unsupportedReason,
      },
      encrypted: {
        generated: false,
        status: "external-valid-sample-required",
        reason: unsupportedReason,
      },
    },
  };
}
