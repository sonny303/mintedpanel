// E4.2 F4.2.2 / TE-4 — payer readiness ("SOP baseline") is a PURE PROJECTION
// over attached payer targets and payer-specific SOP resolution. Never a stored
// boolean.
//
// Start from ACTIVE payer_network_targets (the caller filters to active),
// group by attached payer × state for display, and resolve every underlying
// group target through the SAME `pickTemplate` precedence the app uses.
// "Ready" = every underlying target resolves to an active PAYER-SPECIFIC SOP;
// a global generic fallback is deliberately "Needs SOP". If any grouped target
// is uncovered the aggregate row is "Needs SOP" and the creation link carries
// the payer/state/group match inputs.

import { isFallbackTemplate, pickTemplate } from "./pickTemplate";
import { hasExtensionFillTask } from "./executionTypes";
import type { SOPTemplate } from "@/types";

export interface ReadinessTargetInput {
  payerId: string;
  groupId: string;
  state: string;
}

export interface PayerReadinessInput {
  /** ACTIVE targets only — the caller filters status === "active". */
  targets: readonly ReadinessTargetInput[];
  templates: SOPTemplate[];
  payerName: (payerId: string) => string;
}

export interface UnderlyingTargetReadiness {
  groupId: string;
  ready: boolean;
  resolvedTemplateId: string | null;
}

export interface PayerReadinessRow {
  payerId: string;
  payerName: string;
  state: string;
  /** Every underlying target resolves to a payer-specific SOP. */
  ready: boolean;
  coveredCount: number;
  totalCount: number;
  underlying: UnderlyingTargetReadiness[];
  /** The resolved payer-specific template id when ready; null when Needs SOP. */
  resolvedTemplateId: string | null;
  /** TE-16: the resolved SOP has ≥1 extension_fill task → show form readiness. */
  hasExtensionFill: boolean;
  /** Match key for the "create org-specific SOP" link — the first uncovered
   * target's group when Needs SOP, else null. */
  matchKey: { payerId: string; state: string; groupId: string | null };
}

function targetKey(payerId: string, state: string): string {
  return `${payerId}|${state}`;
}

export function buildPayerReadiness(input: PayerReadinessInput): PayerReadinessRow[] {
  const byPayerState = new Map<string, ReadinessTargetInput[]>();
  for (const t of input.targets) {
    const key = targetKey(t.payerId, t.state);
    const list = byPayerState.get(key) ?? [];
    list.push(t);
    byPayerState.set(key, list);
  }

  const rows: PayerReadinessRow[] = [];
  for (const [, targets] of byPayerState) {
    const { payerId, state } = targets[0];

    const underlying: UnderlyingTargetReadiness[] = targets.map((t) => {
      const tpl = pickTemplate(input.templates, t.payerId, t.state, t.groupId);
      const ready = tpl !== null && !isFallbackTemplate(tpl);
      return { groupId: t.groupId, ready, resolvedTemplateId: tpl?.id ?? null };
    });

    const coveredCount = underlying.filter((u) => u.ready).length;
    const ready = coveredCount === underlying.length;
    const firstReady = underlying.find((u) => u.ready) ?? null;
    const firstUncovered = underlying.find((u) => !u.ready) ?? null;
    const resolvedTemplateId = ready ? (firstReady?.resolvedTemplateId ?? null) : null;

    const resolvedTemplate = resolvedTemplateId
      ? (input.templates.find((tpl) => tpl.id === resolvedTemplateId) ?? null)
      : null;
    const hasExtensionFill = resolvedTemplate
      ? hasExtensionFillTask(resolvedTemplate.taskDefinitions)
      : false;

    rows.push({
      payerId,
      payerName: input.payerName(payerId),
      state,
      ready,
      coveredCount,
      totalCount: underlying.length,
      underlying,
      resolvedTemplateId,
      hasExtensionFill,
      matchKey: {
        payerId,
        state,
        groupId: firstUncovered?.groupId ?? null,
      },
    });
  }

  rows.sort((a, b) => a.payerName.localeCompare(b.payerName) || a.state.localeCompare(b.state));
  return rows;
}

export interface ReadinessSummary {
  total: number;
  ready: number;
  needsSop: number;
}

export function readinessSummary(rows: readonly PayerReadinessRow[]): ReadinessSummary {
  const ready = rows.filter((r) => r.ready).length;
  return { total: rows.length, ready, needsSop: rows.length - ready };
}
