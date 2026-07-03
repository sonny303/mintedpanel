// fill-pdf: server-side AcroForm PDF filling (build spec v1.2, section 8b).
// Input:  { caseId, portalKey }
// Flow: resolve values via the resolve-fill function (single resolver),
// load the blank template from form-templates, fill AcroForm fields with
// pdf-lib, prepend a cover sheet of manual fields, store the output in
// provider-documents, log fill_session + touch + audit rows.
// The PDF is never flattened and the form is never submitted by automation.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  StandardFonts,
  rgb,
} from "npm:pdf-lib@1.17.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ResolvedField {
  id: string;
  selector: string;
  fieldType: string;
  source: string;
  token: string | null;
  notes: string | null;
  value: string | null;
  resolution: "filled" | "partial" | "manual" | "empty";
}

interface ResolveResponse {
  case: {
    id: string;
    orgId: string;
    providerId: string;
    groupId: string | null;
    providerName: string | null;
    payerName: string | null;
    state: string;
    portalKey: string;
  };
  fields: ResolvedField[];
  counts: { filled: number; partial: number; manual: number; empty: number };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  let body: { caseId?: string; portalKey?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const { caseId, portalKey } = body;
  if (!caseId || !portalKey) return jsonResponse({ error: "caseId and portalKey are required" }, 400);

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? null;

  const startedAt = new Date().toISOString();

  // One resolver for web and PDF fills: call resolve-fill under the same JWT.
  const resolveRes = await fetch(`${supabaseUrl}/functions/v1/resolve-fill`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ caseId, portalKey, mapType: "pdf" }),
  });
  if (!resolveRes.ok) {
    const detail = await resolveRes.text();
    return jsonResponse({ error: `resolve-fill failed: ${detail}` }, resolveRes.status);
  }
  const resolved: ResolveResponse = await resolveRes.json();
  if (resolved.fields.length === 0) {
    return jsonResponse(
      { error: `No approved pdf field maps found for portal_key '${portalKey}'` },
      422,
    );
  }

  const { data: template, error: templateError } = await supabase.storage
    .from("form-templates")
    .download(`${portalKey}.pdf`);
  if (templateError || !template) {
    return jsonResponse(
      { error: `Blank template not found: upload the payer form to form-templates/${portalKey}.pdf` },
      404,
    );
  }

  const pdf = await PDFDocument.load(await template.arrayBuffer());
  const form = pdf.getForm();

  let fieldsFilled = 0;
  const skipped: { selector: string; reason: string }[] = [];
  const truthy = new Set(["yes", "true", "on", "x", "checked", "1"]);

  for (const field of resolved.fields) {
    if (field.resolution === "manual") continue;
    if (!field.value) {
      skipped.push({ selector: field.selector, reason: `no value for ${field.token ?? field.source}` });
      continue;
    }
    try {
      const pdfField = form.getField(field.selector);
      if (pdfField instanceof PDFTextField) {
        pdfField.setText(field.value);
      } else if (pdfField instanceof PDFCheckBox) {
        if (truthy.has(field.value.trim().toLowerCase())) pdfField.check();
        else pdfField.uncheck();
      } else if (pdfField instanceof PDFRadioGroup || pdfField instanceof PDFDropdown) {
        const options = pdfField.getOptions();
        const match =
          options.find((o) => o === field.value) ??
          options.find((o) => o.trim().toLowerCase() === field.value!.trim().toLowerCase());
        if (!match) throw new Error(`no option matching '${field.value}'`);
        pdfField.select(match);
      } else {
        throw new Error("unsupported field type");
      }
      fieldsFilled++;
    } catch (err) {
      skipped.push({ selector: field.selector, reason: (err as Error).message });
    }
  }

  // Cover sheet: everything Sowmya still has to complete by hand.
  const needsAttention = resolved.fields.filter(
    (f) => f.resolution === "manual" || f.resolution === "partial" || f.resolution === "empty",
  );
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cover = pdf.insertPage(0, [612, 792]);
  const ink = rgb(0.11, 0.3, 0.24);
  let y = 740;
  cover.drawText("Manual completion checklist", { x: 48, y, size: 18, font: bold, color: ink });
  y -= 26;
  cover.drawText(
    `${resolved.case.providerName ?? "Provider"} — ${resolved.case.payerName ?? portalKey} (${resolved.case.state})`,
    { x: 48, y, size: 11, font },
  );
  y -= 16;
  cover.drawText(
    `${fieldsFilled} fields auto-filled. ${needsAttention.length} fields below need review or completion. Review everything before submitting.`,
    { x: 48, y, size: 10, font },
  );
  y -= 28;
  for (const field of needsAttention) {
    if (y < 60) break;
    const label =
      field.resolution === "partial" ? "PARTIAL" : field.resolution === "empty" ? "NO DATA" : "MANUAL";
    cover.drawText(`[${label}] ${field.selector}`, { x: 48, y, size: 10, font: bold, color: ink });
    y -= 14;
    const instruction =
      field.notes ??
      (field.resolution === "empty"
        ? `No value stored for ${field.token ?? "this field"} — fill by hand.`
        : "Complete by hand.");
    for (const line of wrapText(instruction, 100)) {
      if (y < 60) break;
      cover.drawText(line, { x: 62, y, size: 9, font });
      y -= 12;
    }
    y -= 8;
  }

  // Never flatten: fields stay editable for corrections.
  const bytes = await pdf.save();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `${portalKey}-filled-${stamp}.pdf`;
  const filePath = `${resolved.case.orgId}/cases/${caseId}/${fileName}`;
  const { error: uploadError } = await supabase.storage
    .from("provider-documents")
    .upload(filePath, bytes, { contentType: "application/pdf" });
  if (uploadError) return jsonResponse({ error: `Upload failed: ${uploadError.message}` }, 500);

  const { error: docError } = await supabase.from("provider_documents").insert({
    org_id: resolved.case.orgId,
    provider_id: resolved.case.providerId,
    case_id: caseId,
    doc_type: "filled_form",
    file_path: filePath,
    file_name: fileName,
    uploaded_by: userId,
  });
  if (docError) return jsonResponse({ error: `provider_documents insert failed: ${docError.message}` }, 500);

  const { error: sessionError } = await supabase.from("fill_sessions").insert({
    org_id: resolved.case.orgId,
    case_id: caseId,
    provider_id: resolved.case.providerId,
    portal_key: portalKey,
    fill_mode: "pdf",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    fields_filled: fieldsFilled,
    fields_skipped: skipped,
    performed_by: userId,
  });
  if (sessionError) return jsonResponse({ error: `fill_sessions insert failed: ${sessionError.message}` }, 500);

  const touchNotes = `Generated filled PDF for ${portalKey}: ${fieldsFilled} fields auto-filled, ${needsAttention.length} manual.`;
  const { error: touchError } = await supabase.from("touches").insert({
    org_id: resolved.case.orgId,
    case_id: caseId,
    touch_date: new Date().toISOString().slice(0, 10),
    touch_type: "portal",
    outcome: "form_filled",
    notes: touchNotes,
    coordinator_id: userId,
    source: "extension",
  });
  if (touchError) return jsonResponse({ error: `touches insert failed: ${touchError.message}` }, 500);

  // Mirror the app's writeAudit pattern: fail loudly, never silently.
  const { error: auditError } = await supabase.from("audit_log").insert({
    org_id: resolved.case.orgId,
    user_id: userId,
    user_name: userData?.user?.email ?? null,
    action_type: "CREATE",
    entity_type: "fill_session",
    entity_id: caseId,
    description: touchNotes,
  });
  if (auditError) return jsonResponse({ error: `audit_log insert failed: ${auditError.message}` }, 500);

  const { data: signed } = await supabase.storage
    .from("provider-documents")
    .createSignedUrl(filePath, 300);

  return jsonResponse({
    filePath,
    fileName,
    signedUrl: signed?.signedUrl ?? null,
    fieldsFilled,
    skipped,
    manualFields: needsAttention.map((f) => ({
      selector: f.selector,
      resolution: f.resolution,
      notes: f.notes,
    })),
  });
});
