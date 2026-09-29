// CLIENT-ONLY payer-PDF fill + download (E6.11 B6/B7). Same posture as
// pdfFillClient.ts: pdf-lib only through a dynamic import, nothing under
// src/server/ may import this, and the plan itself is decided in the pure
// payerFormFill.ts.
//
// PHI: the filled form is the most PHI-dense artifact this feature produces. It
// is written in the browser, handed to the user as a local download, and never
// uploaded — the payer-forms bucket holds BLANK global forms only, so a filled
// copy must never go back there. Nothing here logs a value.
//
// The output stays an editable AcroForm on purpose: the coordinator completes
// what only a human can, reviews it, and submits it themselves.
import type { PayerFormFillPlan } from "@/lib/payerFormFill";
import { createPayerPdfFillEventV2, type PdfWriterDisposition } from "@/lib/payerPdfFillOutcomes";
import type { FillEventV2Metadata } from "@/types/fillEventV2";

const CHECKED = /^(y|yes|true|x|on|1|checked)$/i;

export interface PayerFormFillResult {
  /** The saved, filled PDF bytes — pdf-lib output, not yet handed to the browser. */
  output: Uint8Array;
  /** How many fields the document actually accepted — a field the PDF rejects
   * (an option that isn't in its list, a read-only box) is skipped, never
   * fatal, so one bad field can't cost the whole fill. */
  written: number;
  rejected: string[];
  /** Numeric/value-free metadata; writer acceptance remains unverified. */
  outcomes: PdfWriterDisposition[];
}

/** The pdf-lib fill itself, split out from the browser download trigger so it
 * is unit-testable in a plain Node environment (pdf-lib needs no DOM; only
 * `triggerDownload` below does). */
export async function fillPayerFormBytes(
  bytes: ArrayBuffer,
  plan: PayerFormFillPlan,
): Promise<PayerFormFillResult> {
  const { PDFDocument, PDFTextField, PDFDropdown, PDFOptionList, PDFCheckBox, PDFRadioGroup } =
    await import("pdf-lib");
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const rejected: string[] = [];
  const outcomes: PdfWriterDisposition[] = [];
  let written = 0;

  for (const entry of plan.fill) {
    const value = entry.value ?? "";
    let setterInvoked = false;
    try {
      const field = form.getField(entry.selector);
      if (field instanceof PDFTextField) {
        setterInvoked = true;
        field.setText(value);
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        const match = matchOption(field.getOptions(), value);
        if (match === null) {
          rejected.push(entry.label);
          outcomes.push({ mapId: entry.mapId, kind: "option_mismatch" });
          continue;
        }
        setterInvoked = true;
        field.select(match);
      } else if (field instanceof PDFRadioGroup) {
        const match = matchOption(field.getOptions(), value);
        if (match === null) {
          rejected.push(entry.label);
          outcomes.push({ mapId: entry.mapId, kind: "option_mismatch" });
          continue;
        }
        setterInvoked = true;
        field.select(match);
      } else if (field instanceof PDFCheckBox) {
        setterInvoked = true;
        if (CHECKED.test(value.trim())) field.check();
        else field.uncheck();
      } else {
        rejected.push(entry.label);
        outcomes.push({ mapId: entry.mapId, kind: "unsupported" });
        continue;
      }
      written += 1;
      outcomes.push({ mapId: entry.mapId, kind: "accepted" });
    } catch {
      rejected.push(entry.label);
      outcomes.push({ mapId: entry.mapId, kind: setterInvoked ? "rejected" : "needs_mapping" });
    }
  }

  const output = await doc.save();
  return { output, written, rejected, outcomes };
}

export interface PreparedPayerFormFill {
  output: Uint8Array;
  written: number;
  rejected: string[];
  event: FillEventV2Metadata;
}

/** Fill bytes and prepare bounded outcomes without triggering a download. */
export async function preparePayerFormFill(
  bytes: ArrayBuffer,
  plan: PayerFormFillPlan,
): Promise<PreparedPayerFormFill> {
  const { output, written, rejected, outcomes } = await fillPayerFormBytes(bytes, plan);
  const event = createPayerPdfFillEventV2(plan, outcomes);
  return { output, written, rejected, event };
}

export function downloadPayerFormOutput(output: Uint8Array, fileStem: string): void {
  triggerDownload(output, `${fileStem}.pdf`);
}

/** Fill the blank form's bytes from the plan and trigger a local download. */
export async function fillAndDownloadPayerForm(
  bytes: ArrayBuffer,
  plan: PayerFormFillPlan,
  fileStem: string,
): Promise<Omit<PreparedPayerFormFill, "output">> {
  const { output, written, rejected, event } = await preparePayerFormFill(bytes, plan);
  downloadPayerFormOutput(output, fileStem);
  return { written, rejected, event };
}

// A payer's option vocabulary rarely matches our value byte-for-byte ("NC" vs
// "North Carolina ", "Yes" vs "yes"). Exact first, then case/space-insensitive;
// never a fuzzy guess — an unmatched value is reported, not approximated.
function matchOption(options: readonly string[], value: string): string | null {
  if (options.includes(value)) return value;
  const wanted = value.trim().toLowerCase();
  return options.find((option) => option.trim().toLowerCase() === wanted) ?? null;
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
