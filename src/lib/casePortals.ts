// E4.3 F4.3.1 — resolve the portal target(s) a case's open work points at, so
// the "Work in portal" launch action knows which URL to open. A case's portals
// come from its non-completed tasks' online_form SOP steps (each carrying a
// bare `portalKey`), resolved against the org's portals registry to a name +
// formUrl. Pure and tested; the UI resolves the button target from this.
import { normalizePortalKey } from "@/lib/tokenFormat";
import type { Portal, Task } from "@/types";

export interface CasePortalTarget {
  portalKey: string;
  name: string;
  url: string;
}

/** Resolve a set of bare portal keys to launch targets against the registry —
 * one entry per DISTINCT key that resolves to a portal WITH a formUrl (an
 * unverified/no-url portal isn't a launch target). Deterministic order:
 * registry name, then key. */
export function resolvePortalTargets(
  portalKeys: readonly string[],
  portals: readonly Portal[],
): CasePortalTarget[] {
  const portalByKey = new Map<string, Portal>();
  for (const p of portals) {
    const key = normalizePortalKey(p.portalKey);
    if (key) portalByKey.set(key, p);
  }

  const seen = new Set<string>();
  const targets: CasePortalTarget[] = [];
  for (const raw of portalKeys) {
    const key = normalizePortalKey(raw);
    if (!key || seen.has(key)) continue;
    const portal = portalByKey.get(key);
    if (!portal?.formUrl) continue;
    seen.add(key);
    targets.push({ portalKey: key, name: portal.name, url: portal.formUrl });
  }

  targets.sort((a, b) => a.name.localeCompare(b.name) || a.portalKey.localeCompare(b.portalKey));
  return targets;
}

/** Distinct, resolvable portal targets for a case's open tasks — the portal
 * keys among non-completed tasks' online_form steps, resolved to launch
 * targets. */
export function casePortalTargets(
  tasks: readonly Task[],
  portals: readonly Portal[],
): CasePortalTarget[] {
  const keys: string[] = [];
  for (const task of tasks) {
    if (task.status === "completed") continue;
    for (const step of task.sopContent ?? []) {
      if (step.portalKey) keys.push(step.portalKey);
    }
  }
  return resolvePortalTargets(keys, portals);
}
