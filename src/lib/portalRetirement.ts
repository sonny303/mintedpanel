// FE-only "stop using this portal" convention — hide from pickers without a
// schema/soft-delete column. A portal name prefixed with PORTAL_HIDDEN_PREFIX
// is filtered out of pickers; the payer Portals inventory still lists it with
// a "Hidden from pickers" pill. Unlinking referencing SOP steps is a separate
// publish of those templates (portalKey cleared).
import { normalizePortalKey } from "@/lib/tokenFormat";
import type { Portal, SOPTemplate, SOPTaskDefinition } from "@/types";

/** Stored on `portals.name`. Stripped for display; pickers filter on it. */
export const PORTAL_HIDDEN_PREFIX = "[hidden] ";

export function isPortalHiddenFromPickers(portal: Pick<Portal, "name">): boolean {
  return portal.name.startsWith(PORTAL_HIDDEN_PREFIX);
}

export function portalDisplayName(portal: Pick<Portal, "name">): string {
  return isPortalHiddenFromPickers(portal)
    ? portal.name.slice(PORTAL_HIDDEN_PREFIX.length)
    : portal.name;
}

export function withHiddenPortalPrefix(name: string): string {
  const base = name.startsWith(PORTAL_HIDDEN_PREFIX)
    ? name.slice(PORTAL_HIDDEN_PREFIX.length)
    : name;
  return `${PORTAL_HIDDEN_PREFIX}${base}`;
}

/** Pickers offer non-hidden portals, plus the currently selected key so a
 * retired-but-still-linked step remains editable until unlinked. */
export function portalsForPicker(
  portals: readonly Portal[],
  selectedPortalKey: string | null | undefined,
): Portal[] {
  const selected = normalizePortalKey(selectedPortalKey);
  return portals.filter((p) => {
    if (!isPortalHiddenFromPickers(p)) return true;
    return selected != null && normalizePortalKey(p.portalKey) === selected;
  });
}

export interface PortalStepReference {
  templateId: string;
  templateName: string;
  /** Global vs org tier of the template head. */
  templateTier: "global" | "org";
  taskLabel: string;
  stepLabel: string;
  /** Index into taskDefinitions / steps for unlink writers. */
  taskIndex: number;
  stepIndex: number;
}

/** Every non-archived template step that points at this portal key. */
export function listPortalStepReferences(
  templates: readonly SOPTemplate[],
  portalKey: string,
): PortalStepReference[] {
  const want = normalizePortalKey(portalKey);
  if (!want) return [];
  const out: PortalStepReference[] = [];
  for (const t of templates) {
    if (t.archived || t.isArchived) continue;
    const defs = t.taskDefinitions ?? [];
    defs.forEach((def, taskIndex) => {
      (def.steps ?? []).forEach((step, stepIndex) => {
        if (normalizePortalKey(step.portalKey) !== want) return;
        out.push({
          templateId: t.id,
          templateName: t.name,
          templateTier: t.orgId == null ? "global" : "org",
          taskLabel: def.title || `Action ${taskIndex + 1}`,
          stepLabel: step.label || `Step ${stepIndex + 1}`,
          taskIndex,
          stepIndex,
        });
      });
    });
  }
  return out;
}

/** Clear portalKey on every step that matches — returns new taskDefinitions
 * when anything changed, otherwise the input array copied. */
export function unlinkPortalKeyFromTasks(
  taskDefinitions: readonly SOPTaskDefinition[],
  portalKey: string,
): { next: SOPTaskDefinition[]; changed: boolean } {
  const want = normalizePortalKey(portalKey);
  if (!want) return { next: [...taskDefinitions], changed: false };
  let changed = false;
  const next = taskDefinitions.map((def) => {
    let stepsChanged = false;
    const steps = (def.steps ?? []).map((step) => {
      if (normalizePortalKey(step.portalKey) !== want) return step;
      stepsChanged = true;
      changed = true;
      return { ...step, portalKey: "" };
    });
    return stepsChanged ? { ...def, steps } : def;
  });
  return { next, changed };
}
