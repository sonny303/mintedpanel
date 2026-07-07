// CLIENT-ONLY PDF fill + download. pdf-lib is heavy and browser-only, so it is
// imported ONLY through a dynamic import("pdf-lib") inside these functions: that
// keeps it out of the main and server bundles (it lands in its own lazy chunk,
// fetched the first time a user actually fills a PDF). Nothing under src/server/
// may import this module, and the pure mapping (src/lib/pdfFill.ts) stays
// pdf-lib-free so it can be imported anywhere and unit-tested.
//
// PHI note: the token values passed here (SSN last-4, DOB, addresses) stay in the
// browser — they are written into the local PDF and never logged or persisted.
import { mapPdfFields, resolvePdfValues, type PdfFillPlan } from "@/lib/pdfFill";
import type { FieldDictionaryEntry } from "@/types";

export interface PdfAnalysis extends PdfFillPlan {
  /** Every AcroForm field name found in the uploaded PDF. */
  fieldNames: string[];
}

async function loadForm(file: File) {
  const { PDFDocument } = await import("pdf-lib");
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  return { doc, form };
}

// Read the uploaded PDF's field names and run the pure mapping/resolution so the
// UI can preview what will and won't fill BEFORE the user commits to generating.
export async function analyzePdfForm(
  file: File,
  dictionary: FieldDictionaryEntry[],
  tokenValues: Record<string, string>,
): Promise<PdfAnalysis> {
  const { form } = await loadForm(file);
  const fieldNames = form.getFields().map((f) => f.getName());
  const plan = resolvePdfValues(mapPdfFields(fieldNames, dictionary), tokenValues);
  return { fieldNames, ...plan };
}

// Fill the uploaded PDF from the resolved plan and trigger a local download. Text
// fields are set directly; dropdowns/checkboxes are best-effort (a value that
// isn't a valid option is skipped, never thrown). The form is left editable so
// the human reviews and completes it — this never submits anything.
export async function fillAndDownloadPdf(
  file: File,
  dictionary: FieldDictionaryEntry[],
  tokenValues: Record<string, string>,
  fileStem: string,
): Promise<PdfAnalysis> {
  const { PDFDocument, PDFTextField, PDFDropdown, PDFCheckBox } = await import("pdf-lib");
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();

  const fieldNames = form.getFields().map((f) => f.getName());
  const plan = resolvePdfValues(mapPdfFields(fieldNames, dictionary), tokenValues);

  for (const pair of plan.fill) {
    try {
      const field = form.getField(pair.field);
      if (field instanceof PDFTextField) {
        field.setText(pair.value);
      } else if (field instanceof PDFDropdown) {
        field.select(pair.value);
      } else if (field instanceof PDFCheckBox) {
        if (/^(y|yes|true|x|on|1|checked)$/i.test(pair.value.trim())) field.check();
      }
    } catch {
      // A single field that rejects its value must never abort the whole fill —
      // the rest of the form still fills and the user completes the remainder.
    }
  }

  const output = await doc.save();
  triggerDownload(output, `${fileStem}-filled.pdf`);
  return { fieldNames, ...plan };
}

function triggerDownload(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
