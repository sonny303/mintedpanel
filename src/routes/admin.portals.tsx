// E6.1 F6.1.6 → E6.5 → Slice G: the standalone Portals registry retired into
// the Payer Setup module; E6.5 folded portal registration/capture/train into
// the SOP form step, and Slice G folded the interim SOPs tab, so this now
// lands on Payer Setup. The old ?payerId= context (Add-portal preselect) is
// dropped — registration lives in the Template Editor. Legacy URLs never
// dead-end.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/portals")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/setup", replace: true });
  },
});
