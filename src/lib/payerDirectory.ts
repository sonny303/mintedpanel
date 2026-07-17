// E1.6 F1.6.1 — pure directory filtering. Search matches name AND aliases
// (case-insensitive substring); filters are state (states[] membership) and
// payer_kind. The R2 directory defaults the kind filter to commercial —
// government kinds exist as dormant rows and stay reachable via the filter.
import type { Payer, PayerKind } from "@/types";

export type DirectoryKindFilter = PayerKind | "all";

export const DEFAULT_DIRECTORY_KIND: DirectoryKindFilter = "commercial";

export const PAYER_KIND_LABELS: Record<PayerKind, string> = {
  commercial: "Commercial",
  medicare: "Medicare",
  medicaid: "Medicaid",
  medicaid_mco: "Medicaid MCO",
  medicare_advantage: "Medicare Advantage",
  tricare: "TRICARE",
};

export interface DirectoryFilters {
  query: string;
  state: string | "all";
  kind: DirectoryKindFilter;
}

export function filterDirectoryRows(payers: readonly Payer[], filters: DirectoryFilters): Payer[] {
  const q = filters.query.trim().toLowerCase();
  return payers
    .filter((p) => {
      if (filters.kind !== "all" && (p.payerKind ?? "commercial") !== filters.kind) return false;
      if (filters.state !== "all" && !(p.states ?? []).includes(filters.state)) return false;
      if (q) {
        const inName = p.name.toLowerCase().includes(q);
        const inAlias = (p.aliases ?? []).some((a) => a.toLowerCase().includes(q));
        if (!inName && !inAlias) return false;
      }
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Compact states display: "NC, SC, TX +4". */
export function formatStates(states: readonly string[] | null | undefined, max = 4): string {
  const list = states ?? [];
  if (list.length === 0) return "—";
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} +${list.length - max}`;
}
