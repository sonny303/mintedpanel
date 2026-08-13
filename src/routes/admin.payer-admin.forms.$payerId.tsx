// E6.5 F6.5.2 → Slice G — the standalone form-onboarding runner retired:
// portal registration and training live INSIDE the Template Editor's
// online-form step panel; mock dry run / Mark proven live in the Workbench
// Train forms tab. Slice G folded the interim SOPs tab, so this lands on
// Payer Setup. Legacy URLs never dead-end.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/payer-admin/forms/$payerId")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/setup", replace: true });
  },
});
