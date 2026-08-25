// CLIENT-ONLY AcroForm reader for E6.11 (B3/B4). Same contract as
// pdfFillClient.ts: pdf-lib is reached ONLY through a dynamic
// `import("pdf-lib")` so it stays in its own lazy chunk and out of every server
// bundle, and the rules that turn a field into a registry row stay in the pure
// pdfFieldImport.ts.
//
// The bytes come from the payer-forms signing route's short-lived signed URL.
// A blank payer form is not PHI — it is the same public form the payer
// publishes — so reading it in the browser adds no exposure; nothing is
// written back.
// Type-only import: erased at compile time, so pdf-lib still arrives solely
// through the dynamic import below.
import type { PDFField } from "pdf-lib";
import type { PdfAcroFieldDescriptor } from "@/lib/pdfFieldImport";

/** Fetch a blank form's bytes from its signed Storage URL. */
export async function fetchPdfBytes(signedUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`Could not download the form (${res.status})`);
  return res.arrayBuffer();
}

/**
 * Every AcroForm field in the document, in pdf-lib's field order (the
 * AcroForm tree order, which tracks the authored tab order far better than
 * anything we could re-derive) with its tooltip and option vocabulary.
 *
 * An empty array is a real, expected answer: it means the file is a FLAT scan
 * with no fillable fields, which the caller must report as such rather than
 * treating as a failed read.
 */
export async function readPdfAcroFields(bytes: ArrayBuffer): Promise<PdfAcroFieldDescriptor[]> {
  const {
    PDFDocument,
    PDFTextField,
    PDFCheckBox,
    PDFRadioGroup,
    PDFDropdown,
    PDFOptionList,
    PDFName,
    PDFString,
    PDFHexString,
  } = await import("pdf-lib");
  // `/TU` — the alternate field name Acrobat shows as a tooltip and screen
  // readers announce. Where a payer bothered to write one it is the best label
  // the form carries, so it beats any name-splitting heuristic.
  const readTooltip = (field: PDFField): string | null => {
    const value = field.acroField.dict.lookup(PDFName.of("TU"));
    if (value instanceof PDFString || value instanceof PDFHexString) {
      const text = value.decodeText().trim();
      return text === "" ? null : text;
    }
    return null;
  };
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const descriptors: PdfAcroFieldDescriptor[] = [];
  for (const field of form.getFields()) {
    const name = field.getName();
    let type: PdfAcroFieldDescriptor["type"] = "button";
    let options: string[] | null = null;
    if (field instanceof PDFTextField) {
      type = "text";
    } else if (field instanceof PDFCheckBox) {
      type = "checkbox";
    } else if (field instanceof PDFRadioGroup) {
      type = "radio";
      options = field.getOptions();
    } else if (field instanceof PDFDropdown) {
      type = "dropdown";
      options = field.getOptions();
    } else if (field instanceof PDFOptionList) {
      type = "optionlist";
      options = field.getOptions();
    } else {
      // Pushbuttons and signature boxes. Named here as "button" so the pure
      // layer drops them by the same rule it uses everywhere else.
      type = "button";
    }
    descriptors.push({ name, type, tooltip: readTooltip(field), options });
  }
  return descriptors;
}
