// E6.1 F6.1.4/F6.1.6 (2026-07-19) — the Settings page retires. Member
// management (invite, role change) and the user's profile section relocate to
// Org Detail; the Organization tab's group/facility panels are superseded by
// the wizard sections and the Groups surfaces (E6.2); Add organization lives
// on /onboarding. This URL stays alive as a redirect (legacy URLs never
// dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/org-detail", replace: true });
  },
});
