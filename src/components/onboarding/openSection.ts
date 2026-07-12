// Shared wizard section-targeting behavior (E1.0 TE-4, reused by E1.1's
// dual-path exit): scroll the section card into view and move keyboard focus
// to its heading — stable DOM ids only, no route or Zustand state.
import { sectionHeadingId, type OnboardingSectionDef } from "@/lib/onboardingProgress";

export function openSection(def: OnboardingSectionDef) {
  const card = document.getElementById(def.domId);
  card?.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById(sectionHeadingId(def))?.focus({ preventScroll: true });
}
