// Pure view logic for the Payer Detail → Portals tab (MP-3) and the portal
// drawer status vocabulary. Inventory = portals with payer_id matching this
// payer ∪ portals referenced by this payer's non-archived templates.
import { fmtDate } from "@/lib/format";
import {
  isPortalHiddenFromPickers,
  listPortalStepReferences,
  portalDisplayName,
} from "@/lib/portalRetirement";
import { normalizePortalKey } from "@/lib/tokenFormat";
import type { Portal, PortalFieldMap, SOPTemplate } from "@/types";

export type PayerPortalStatusKey =
  | "hidden"
  | "drift"
  | "proven"
  | "trained"
  | "captured"
  | "registered"
  | "no_fields";

/** Matches StatusPill tones used by the Portals tab — kept local so this
 * module stays free of component imports. */
export type PayerPortalStatusTone =
  | "green"
  | "amber"
  | "red"
  | "blue"
  | "neutral"
  | "brand";

export interface PayerPortalStatus {
  key: PayerPortalStatusKey;
  label: string;
  tone: PayerPortalStatusTone;
}

export interface PayerPortalInventoryRow {
  portal: Portal;
  displayName: string;
  tier: "global" | "org";
  status: PayerPortalStatus;
  usedByCount: number;
  lastProvenLabel: string;
  formUrlDisplay: string;
  driftCount: number;
  approvedCount: number;
  mapCount: number;
}

export function displayPortalUrl(url: string | null | undefined): string {
  if (!url) return "—";
  return url.replace(/^https?:\/\//, "");
}

export function payerPortalStatus(input: {
  portal: Portal;
  mapCount: number;
  approvedCount: number;
  driftCount: number;
}): PayerPortalStatus {
  if (isPortalHiddenFromPickers(input.portal)) {
    return { key: "hidden", label: "Hidden from pickers", tone: "neutral" };
  }
  if (input.driftCount > 0) {
    return {
      key: "drift",
      label: `Drift — ${input.driftCount} field${input.driftCount === 1 ? "" : "s"}`,
      tone: "red",
    };
  }
  if (input.portal.provenAt) {
    return { key: "proven", label: "Proven", tone: "green" };
  }
  if (input.approvedCount > 0) {
    return { key: "trained", label: "Trained", tone: "blue" };
  }
  if (input.mapCount > 0) {
    return { key: "captured", label: "Captured", tone: "amber" };
  }
  if (!input.portal.formUrl) {
    return { key: "no_fields", label: "Registered · no URL", tone: "amber" };
  }
  return { key: "registered", label: "Registered · no fields", tone: "amber" };
}

/**
 * Build the payer-scoped portal inventory. Hidden portals stay listed.
 * Dedupes by portal id; prefers the portal row over key-only matches.
 */
export function buildPayerPortalInventory(input: {
  payerId: string;
  portals: readonly Portal[];
  templates: readonly SOPTemplate[];
  fieldMaps: readonly PortalFieldMap[];
  driftByPortal: ReadonlyMap<string, PortalFieldMap[]>;
}): PayerPortalInventoryRow[] {
  const { payerId, portals, templates, fieldMaps, driftByPortal } = input;
  const payerTemplates = templates.filter(
    (t) => t.payerId === payerId && !t.archived && !t.isArchived,
  );

  const byId = new Map<string, Portal>();
  for (const p of portals) {
    if (p.payerId === payerId) byId.set(p.id, p);
  }
  for (const t of payerTemplates) {
    for (const def of t.taskDefinitions ?? []) {
      for (const step of def.steps ?? []) {
        const key = normalizePortalKey(step.portalKey);
        if (!key) continue;
        const match = portals.find((p) => normalizePortalKey(p.portalKey) === key);
        if (match) byId.set(match.id, match);
      }
    }
  }

  const mapsByKey = new Map<string, PortalFieldMap[]>();
  for (const m of fieldMaps) {
    if (m.status === "retired") continue;
    const list = mapsByKey.get(m.portalKey) ?? [];
    list.push(m);
    mapsByKey.set(m.portalKey, list);
  }

  const rows: PayerPortalInventoryRow[] = [];
  for (const portal of byId.values()) {
    const maps = mapsByKey.get(portal.portalKey) ?? [];
    const approvedCount = maps.filter((m) => m.status === "approved").length;
    const driftCount = driftByPortal.get(portal.portalKey)?.length ?? 0;
    const usedByCount = listPortalStepReferences(payerTemplates, portal.portalKey).length;
    rows.push({
      portal,
      displayName: portalDisplayName(portal),
      tier: portal.orgId == null ? "global" : "org",
      status: payerPortalStatus({
        portal,
        mapCount: maps.length,
        approvedCount,
        driftCount,
      }),
      usedByCount,
      lastProvenLabel: portal.provenAt ? fmtDate(portal.provenAt) : "never",
      formUrlDisplay: displayPortalUrl(portal.formUrl),
      driftCount,
      approvedCount,
      mapCount: maps.length,
    });
  }

  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
