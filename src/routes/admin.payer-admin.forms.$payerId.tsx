// E6.5 F6.5.2/F6.5.3 — the standalone form-onboarding runner retires: portal
// registration, training, and the (now mock-data) dry run live INSIDE the SOP
// editor's online-form step panel. This URL stays alive as a redirect (legacy
// URLs never dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/payer-admin/forms/$payerId")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/sops", replace: true });
  },
});
