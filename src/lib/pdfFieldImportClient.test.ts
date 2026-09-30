import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { readPdfAcroFields } from "@/lib/pdfFieldImportClient";

describe("readPdfAcroFields", () => {
  it("reads the exact selector, tooltip, and page from a two-page AcroForm", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const secondPage = doc.addPage();
    const field = doc.getForm().createTextField("undefined_2");
    field.addToPage(secondPage);
    field.acroField.dict.set(PDFName.of("TU"), PDFString.of("undefined"));

    const saved = await doc.save();
    const fields = await readPdfAcroFields(Uint8Array.from(saved).buffer);
    expect(fields).toEqual([
      {
        name: "undefined_2",
        type: "text",
        tooltip: "undefined",
        options: null,
        pageNumber: 2,
      },
    ]);
  });
});
