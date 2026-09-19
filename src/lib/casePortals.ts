// E4.3 F4.3.1 — resolve the portal target(s) a case's open work points at, so
// the "Work in portal" launch action knows which URL to open. A case's portals
// come from its non-completed tasks' online_form SOP steps (each carrying a
// bare `portalKey`), resolved against the org's portals registry to a name +
// formUrl. Pure and tested; the UI resolves the button target from this.
import { normalizePortalKey } from "@/lib/tokenFormat";
import type { Portal, SOPStep, Task, TaskStatus } from "@/types";

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

export type HandoffFacilityLoadState = "loading" | "error" | "ready";

export interface HandoffFacilityOption {
  id: string;
  name: string;
}

/** Preserve the exact legacy credential_cases facility when the optional
 * case_facilities relation is present but has no corresponding row. The joined
 * facility must prove the same ID; failed/loading child reads still block in
 * resolveHandoffFacility before these options are considered. */
export function handoffFacilityOptions(
  facilities: readonly HandoffFacilityOption[],
  caseFacilityId: string | null,
  joinedCaseFacility: HandoffFacilityOption | null,
): HandoffFacilityOption[] {
  const options = [...facilities];
  if (
    caseFacilityId !== null &&
    joinedCaseFacility?.id === caseFacilityId &&
    !options.some((facility) => facility.id === caseFacilityId)
  ) {
    options.push(joinedCaseFacility);
  }
  return options;
}

export type HandoffFacilityResolution =
  | { status: "ready"; facilityId: string | undefined }
  | {
      status: "blocked";
      reason: "loading" | "load_failed" | "selection_required" | "selection_invalid";
    };

/** Resolve the launch location without a primary-location fallback. An
 * explicit selection always wins while valid; if it becomes stale the caller
 * must ask again. The case's current facility is used only when it is itself
 * present in the loaded case-location set. */
export function resolveHandoffFacility(
  loadState: HandoffFacilityLoadState,
  facilities: readonly HandoffFacilityOption[],
  caseFacilityId: string | null,
  selectedFacilityId: string | undefined,
): HandoffFacilityResolution {
  if (loadState === "loading") return { status: "blocked", reason: "loading" };
  if (loadState === "error") return { status: "blocked", reason: "load_failed" };

  const hasFacility = (id: string) => facilities.some((facility) => facility.id === id);
  if (selectedFacilityId !== undefined) {
    return hasFacility(selectedFacilityId)
      ? { status: "ready", facilityId: selectedFacilityId }
      : { status: "blocked", reason: "selection_invalid" };
  }
  if (caseFacilityId !== null) {
    return hasFacility(caseFacilityId)
      ? { status: "ready", facilityId: caseFacilityId }
      : { status: "blocked", reason: "selection_invalid" };
  }
  if (facilities.length === 0) return { status: "ready", facilityId: undefined };
  if (facilities.length === 1) return { status: "ready", facilityId: facilities[0].id };
  return { status: "blocked", reason: "selection_required" };
}

/** The launcher is narrower than the step body: only the active incomplete
 * online-form step in an unlocked, unfinished task can send case context. */
export function isPortalHandoffStepEligible(
  step: SOPStep,
  stepIndex: number,
  firstIncompleteIndex: number,
  taskLocked: boolean,
  taskStatus: TaskStatus,
): boolean {
  return (
    !taskLocked &&
    taskStatus !== "completed" &&
    !step.isCompleted &&
    stepIndex === firstIncompleteIndex &&
    (step.stepType ?? "online_form") === "online_form" &&
    normalizePortalKey(step.portalKey) !== null
  );
}
