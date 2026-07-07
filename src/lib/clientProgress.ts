// Client Progress v1: derivations for the owner-facing /client-progress page.
// Every status string the practice owner sees comes from OWNER_STATUSES —
// internal labels and action buckets never leak past ownerStatusKey. Pure
// logic, tested in clientProgress.test.ts.
import type { CredentialCase, Payer, StatusConfig } from "@/types";
import {
  IN_NETWORK_LABEL,
  NOT_REQUIRED_LABEL,
  OON_LABEL,
  PRE_CRED_PAYER_NAME,
} from "./statusLabels";

// Re-exported for existing importers (e.g. clientProgress.test.ts) that pull
// the sentinel payer name from this module.
export { PRE_CRED_PAYER_NAME };

export type OwnerStatusKey = "in_progress" | "submitted" | "with_payer" | "approved" | "active";

export interface OwnerStatusDisplay {
  label: string;
  /** Existing status-hue token, passed straight into StatusPill. */
  color: string;
  /** Orders least → most advanced; picks the best case per payer. */
  rank: number;
}

/** The locked owner-safe wording set. Nothing else renders on the page. */
export const OWNER_STATUSES: Record<OwnerStatusKey, OwnerStatusDisplay> = {
  in_progress: { label: "In progress", color: "var(--mp-info)", rank: 0 },
  submitted: { label: "Submitted", color: "var(--mp-pending)", rank: 1 },
  with_payer: { label: "With payer", color: "var(--mp-pending)", rank: 2 },
  approved: { label: "Approved", color: "var(--mp-ok)", rank: 3 },
  active: { label: "Active", color: "var(--mp-ok)", rank: 4 },
};

// The credentialing labels both seeded orgs share, mapped explicitly. null =
// the owner never sees the row (the org opted the provider out of the payer).
const LABEL_TO_KEY: Record<string, OwnerStatusKey | null> = {
  [IN_NETWORK_LABEL]: "active",
  Approved: "approved",
  Submitted: "submitted",
  "In Progress": "in_progress",
  "Not Started": "in_progress",
  "Waiting on Provider": "in_progress",
  Denied: "in_progress",
  [OON_LABEL]: null,
  [NOT_REQUIRED_LABEL]: null,
};

/**
 * Statuses are org-configurable, so unknown labels fall back to the action
 * bucket — the owner still only ever sees one of the five locked wordings.
 */
export function ownerStatusKey(
  statusLabel: string | null,
  actionBucket: string | null,
): OwnerStatusKey | null {
  if (statusLabel != null && statusLabel in LABEL_TO_KEY) return LABEL_TO_KEY[statusLabel];
  if (actionBucket === "complete") return "approved";
  if (actionBucket === "waiting_payer") return "with_payer";
  return "in_progress";
}

export interface PayerProgressLine {
  caseId: string;
  payerId: string;
  payerName: string;
  statusKey: OwnerStatusKey;
  /** confirmed ?? expected; null until either is set. */
  effectiveDate: string | null;
}

export interface ProviderProgressCardModel<P> {
  provider: P;
  /** One line per payer with a visible case, alphabetical by payer name. */
  lines: PayerProgressLine[];
  inNetwork: number;
  /** The org's active payer set minus payers this provider is opted out of. */
  denominator: number;
}

/**
 * One card per provider. The denominator is derived from the org's payer set
 * (active payers, pre-cred sentinel excluded) — never from a hardcoded count.
 * A payer whose only case for the provider maps to null (Not Required, OON)
 * drops out of that provider's denominator; a payer with no case yet still
 * counts, it just has no line. When a provider has several cases with the
 * same payer (multi-state), the most advanced one represents the payer.
 */
export function buildClientProgress<P extends { id: string }>(
  providers: P[],
  cases: CredentialCase[],
  payers: Payer[],
  statusConfigs: StatusConfig[],
): ProviderProgressCardModel<P>[] {
  const statusById = new Map(statusConfigs.map((s) => [s.id, s]));
  const realPayers = payers.filter((p) => p.isActive && p.name !== PRE_CRED_PAYER_NAME);
  const realPayerById = new Map(realPayers.map((p) => [p.id, p]));

  const casesByProvider = new Map<string, CredentialCase[]>();
  for (const c of cases) {
    if (!realPayerById.has(c.payerId)) continue;
    const list = casesByProvider.get(c.providerId) ?? [];
    list.push(c);
    casesByProvider.set(c.providerId, list);
  }

  return providers.map((provider) => {
    const bestByPayer = new Map<string, PayerProgressLine>();
    const optedOutPayers = new Set<string>();

    for (const c of casesByProvider.get(provider.id) ?? []) {
      const payer = realPayerById.get(c.payerId);
      if (!payer) continue;
      const status = c.credentialingStatusId
        ? (statusById.get(c.credentialingStatusId) ?? null)
        : null;
      const key = ownerStatusKey(status?.label ?? null, status?.actionBucket ?? null);
      if (key === null) {
        optedOutPayers.add(c.payerId);
        continue;
      }
      const prev = bestByPayer.get(c.payerId);
      if (!prev || OWNER_STATUSES[key].rank > OWNER_STATUSES[prev.statusKey].rank) {
        bestByPayer.set(c.payerId, {
          caseId: c.id,
          payerId: c.payerId,
          payerName: payer.name,
          statusKey: key,
          effectiveDate: c.confirmedEffectiveDate ?? c.expectedEffectiveDate,
        });
      }
    }

    // Opted out only when no other case keeps the payer visible.
    const droppedCount = [...optedOutPayers].filter((id) => !bestByPayer.has(id)).length;
    const lines = [...bestByPayer.values()].sort((a, b) => a.payerName.localeCompare(b.payerName));

    return {
      provider,
      lines,
      inNetwork: lines.filter((l) => l.statusKey === "active").length,
      denominator: realPayers.length - droppedCount,
    };
  });
}
