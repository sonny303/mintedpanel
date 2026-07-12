// Presentation helpers for payer catalog metadata (E1.5 picker / F1.5.1).
// The E1.6 columns are optional on the domain type — every helper degrades
// to "" when metadata is absent so pre-catalog payers stay renderable.
import type { Payer } from "@/types";

export function payerKindLabel(payer: Payer): string {
  return payer.payerKind ? payer.payerKind.replaceAll("_", " ") : "";
}

export function payerStatesLabel(payer: Payer): string {
  return payer.states && payer.states.length > 0 ? payer.states.join(", ") : "";
}

/** "commercial · NC, KS" — the picker's metadata line; "" without metadata. */
export function payerMetaSummary(payer: Payer): string {
  return [payerKindLabel(payer), payerStatesLabel(payer)].filter(Boolean).join(" · ");
}
