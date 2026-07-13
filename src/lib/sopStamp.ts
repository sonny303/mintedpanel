// E2.2 — the version-stamp contract for generated tasks (TE-2). The stamp is
// the (sop_template_id, sop_version) pair the task's sop_content was RESOLVED
// from, read off the SAME head row snapshot the resolver consumed — never a
// re-read of current_version at write time, which could race a publish and
// stamp v(N+1) onto vN content. A publish landing between the head read and
// the RPC call is therefore harmless: the batch stamps the version whose
// content it actually resolved (Model A — the older batch keeps its version)
// and the composite FK to the immutable sop_template_versions row guarantees
// the pair exists however the race lands.
//
// Both-or-neither (the tasks_sop_stamp_both_or_neither CHECK): a head row
// with no readable currentVersion yields an UNSTAMPED task — legacy-shaped
// NULL/NULL, never a guessed version paired with content it may not match.
import { isFallbackTemplate } from "@/lib/pickTemplate";
import type { SOPTemplate } from "@/types";

export interface SopStamp {
  sopTemplateId: string | null;
  sopVersion: number | null;
}

/** The stamp for tasks resolved from this head-row snapshot (null → NULL/NULL). */
export function templateStamp(
  template: Pick<SOPTemplate, "id" | "currentVersion"> | null,
): SopStamp {
  if (!template) return { sopTemplateId: null, sopVersion: null };
  const version = template.currentVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { sopTemplateId: null, sopVersion: null };
  }
  return { sopTemplateId: template.id, sopVersion: version };
}

/** Attach the template's stamp to every resolved task payload. */
export function stampTasks<T extends object>(
  tasks: T[],
  template: Pick<SOPTemplate, "id" | "currentVersion"> | null,
): (T & SopStamp)[] {
  const stamp = templateStamp(template);
  return tasks.map((t) => ({ ...t, ...stamp }));
}

/** Minimal task shape the case-list derivations below need. */
export interface StampedTaskRef {
  caseId: string | null;
  sopTemplateId?: string | null;
  sopVersion?: number | null;
}

/** Ids of every fallback-shaped template (global + payerless, TE-3 identity).
 * Archived rows stay included — a case stamped with a since-archived fallback
 * still ran on the generic SOP. */
export function fallbackTemplateIds(templates: readonly SOPTemplate[]): Set<string> {
  return new Set(templates.filter(isFallbackTemplate).map((t) => t.id));
}

/** F2.2.2 — a case "uses the generic SOP" iff any of its tasks is stamped
 * with a fallback template's id (derived from stamps, never stored). */
export function caseIdsUsingGenericSop(
  tasks: readonly StampedTaskRef[],
  fallbackIds: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const t of tasks) {
    if (t.caseId && t.sopTemplateId && fallbackIds.has(t.sopTemplateId)) out.add(t.caseId);
  }
  return out;
}

/** The distinct stamped (template, version) pairs across a case's tasks, in
 * first-seen task order — one provenance line per generation cycle (a
 * reapplied case carries two). Unstamped (legacy) tasks contribute nothing. */
export function distinctStampPairs(
  tasks: readonly StampedTaskRef[],
): Array<{ sopTemplateId: string; sopVersion: number }> {
  const seen = new Set<string>();
  const pairs: Array<{ sopTemplateId: string; sopVersion: number }> = [];
  for (const t of tasks) {
    if (!t.sopTemplateId || typeof t.sopVersion !== "number") continue;
    const key = `${t.sopTemplateId}|${t.sopVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ sopTemplateId: t.sopTemplateId, sopVersion: t.sopVersion });
  }
  return pairs;
}
