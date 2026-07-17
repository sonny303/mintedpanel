// Shared wizard section-targeting behavior (E1.0 TE-4, reused by E1.1's
// dual-path exit and the E4.2 "Configure credentialing scope" hand-off). The
// jump must be PERCEIVABLE, not just a focus change AT-only users could miss
// (E4.2 F item 4): scroll the section card into view, move keyboard focus to its
// heading, AND flash a temporary highlight ring on the card. Stable DOM ids
// only — no route or Zustand state. Reduced-motion aware: smooth scroll and the
// fade pulse are dropped for `prefers-reduced-motion: reduce` (instant scroll +
// a brief static ring). The highlight uses the Web Animations API so a React
// re-render of the card never clobbers it mid-flash.
import { sectionHeadingId, type OnboardingSectionDef } from "@/lib/onboardingProgress";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function flashHighlight(card: HTMLElement, reduced: boolean): void {
  if (typeof card.animate !== "function") return;
  if (reduced) {
    // A brief, static ring — no motion.
    card.animate(
      [
        { boxShadow: "0 0 0 3px rgba(27,77,62,0.45)" },
        { boxShadow: "0 0 0 3px rgba(27,77,62,0.45)" },
      ],
      { duration: 1200 },
    );
    return;
  }
  card.animate(
    [
      { boxShadow: "0 0 0 0 rgba(27,77,62,0)" },
      { boxShadow: "0 0 0 3px rgba(27,77,62,0.5)", offset: 0.15 },
      { boxShadow: "0 0 0 3px rgba(27,77,62,0)" },
    ],
    { duration: 1600, easing: "ease-out" },
  );
}

export function openSection(def: OnboardingSectionDef): void {
  if (typeof document === "undefined") return;
  const card = document.getElementById(def.domId);
  if (!card) return;
  const reduced = prefersReducedMotion();
  card.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  // Move keyboard focus to the section heading (tabIndex={-1}) so the jump is
  // announced to AT/keyboard users, then reinforce it visually.
  document.getElementById(sectionHeadingId(def))?.focus({ preventScroll: true });
  flashHighlight(card, reduced);
}
