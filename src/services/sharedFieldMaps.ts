// E6.9 F6.9.2/F6.9.8 — the ORG-FREE shared propose path.
//
// SERVER-ONLY. Do not import from browser code.
//
// Why this exists separately from `proposeFieldMap`: training a payer form has
// no org at all (D10). The existing route cannot serve it —
//   * it interpolates `ctx.orgId` into its dedupe filter and stamps it on the
//     insert, so every captured row would land org-scoped; and
//   * it runs on `authenticate()`, which 400s a multi-org caller that sends no
//     `x-org-id` — exactly what training mode does send (F6.9.8).
// So this path runs on the user-scoped `authenticateUser()` guard (the
// /api/me/orgs precedent) and writes through the SECURITY DEFINER RPC, which
// is the only way a shared row can be inserted at all (shared rows fail
// browser RLS INSERT).
//
// Ungated for any signed-in user (D11): there is no role model, and E6.7
// explicitly rejected platform-role gating. The JWT verification in
// authenticateUser IS the gate.
//
// No audit row: `audit_log.org_id` is NOT NULL and there is no org here. The
// row's `updated_at` is the trail (D14).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { camelizeRow } from "@/lib/case";
import { validateControlOptionsInput } from "@/lib/controlOptions";
import { normalizeFieldLabel, normalizePortalKey, normalizeTokenKey } from "@/lib/tokenFormat";
import type { PortalFieldMap } from "@/types";

const FIELD_TYPES = new Set(["text", "select", "radio", "checkbox", "date", "file"]);

export interface SharedProposeBody {
  portal_key?: unknown;
  selector?: unknown;
  field_label?: unknown;
  form_section?: unknown;
  page_step?: unknown;
  field_type?: unknown;
  sort_order?: unknown;
  control_options?: unknown;
}

export type SharedProposeResult =
  { kind: "ok"; map: PortalFieldMap } | { kind: "rejected"; status: number; message: string };

const asOptionalString = (value: unknown): string | null => {
  if (value == null) return null;
  return typeof value === "string" ? value : "";
};

/**
 * Propose one shared (`org_id IS NULL`) registry row from extension capture.
 *
 * Idempotent on the F6.9.1 per-tier unique index: the RPC is
 * `ON CONFLICT DO NOTHING` + re-read, then refreshes presentation columns
 * (`sort_order`, `field_label`, `form_section`, `page_step`) without touching
 * decision fields — so re-capturing a page returns each existing row with its
 * status/token/source intact while repairing DOM-order drift (BITE-CAP-02).
 *
 * Shape-only, enforced here as well as in the extension: the accepted keys are
 * portal identity, page/section structure, label, selector and control type.
 * There is no field-value key in this contract, so a value cannot ride in.
 */
export async function proposeSharedFieldMap(
  db: SupabaseClient<Database>,
  body: SharedProposeBody,
): Promise<SharedProposeResult> {
  const portalKey = normalizePortalKey(asOptionalString(body?.portal_key) ?? "");
  if (!portalKey) return { kind: "rejected", status: 422, message: "portal_key is required" };

  const rawSelector = asOptionalString(body?.selector) ?? "";
  const selector = rawSelector.trim();
  if (!selector) return { kind: "rejected", status: 422, message: "selector is required" };

  const fieldType = (asOptionalString(body?.field_type) ?? "text") || "text";
  if (!FIELD_TYPES.has(fieldType)) {
    return {
      kind: "rejected",
      status: 422,
      message: `field_type must be one of ${[...FIELD_TYPES].join(", ")}`,
    };
  }

  for (const key of ["field_label", "form_section", "page_step"] as const) {
    const value = body?.[key];
    if (value != null && typeof value !== "string") {
      return { kind: "rejected", status: 422, message: `${key} must be a string` };
    }
  }

  const sortOrderRaw = body?.sort_order;
  if (sortOrderRaw != null && typeof sortOrderRaw !== "number") {
    return { kind: "rejected", status: 422, message: "sort_order must be a number" };
  }

  const optionsCheck = validateControlOptionsInput(
    body?.control_options === undefined ? null : body.control_options,
  );
  if (optionsCheck.kind === "rejected") {
    return { kind: "rejected", status: 422, message: optionsCheck.message };
  }
  const controlOptions =
    optionsCheck.options && optionsCheck.options.length > 0 ? optionsCheck.options : null;

  const rpc = db.rpc.bind(db);
  const { data, error } = await rpc("propose_shared_field_map", {
    p_portal_key: portalKey,
    // Normalized at the write boundary, the same key the field dictionary
    // learns on, so a shared proposal joins the same suggestions.
    p_field_label: (normalizeFieldLabel(asOptionalString(body?.field_label) ?? "") ||
      null) as unknown as string,
    p_selector: selector,
    p_form_section: (asOptionalString(body?.form_section)?.trim() || null) as unknown as string,
    p_page_step: (asOptionalString(body?.page_step)?.trim() || null) as unknown as string,
    p_field_type: fieldType,
    p_sort_order: (typeof sortOrderRaw === "number" ? sortOrderRaw : null) as unknown as number,
    p_control_options: (controlOptions as unknown as string) ?? null,
  });
  if (error) throw error;

  const map = camelizeRow<PortalFieldMap>(data);
  return { kind: "ok", map: { ...map, token: normalizeTokenKey(map.token) } };
}
