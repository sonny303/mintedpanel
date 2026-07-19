// E6.1 F6.1.6 (2026-07-19) — the reserved E0.0 "Scope" journey slot retires;
// its job (defining the org's scope) lives in the one-time onboarding wizard.
// A ?section= deep link is preserved so scoped links land focused on their
// section (TS-120). This URL stays alive as a redirect (legacy URLs never
// dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ACTIVE_SECTIONS, type ActiveSectionKey } from "@/lib/onboardingProgress";

interface ScopeSearch {
  section?: ActiveSectionKey;
}

export const Route = createFileRoute("/scope")({
  validateSearch: (search: Record<string, unknown>): ScopeSearch => {
    const raw = typeof search.section === "string" ? search.section : undefined;
    const match = ACTIVE_SECTIONS.find((s) => s.key === raw);
    return match ? { section: match.key } : {};
  },
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/onboarding/wizard",
      search: search.section ? { section: search.section } : {},
      replace: true,
    });
  },
});
