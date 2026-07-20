// E6.1 F6.1.6 → E6.5: the standalone Portals registry page retired into the
// Payer Setup workspace; E6.5 folds portal registration/capture/train into the
// SOP form step, so this now lands on the SOPs tab. The old ?payerId= context
// (Add-portal preselect) is dropped — registration lives in the editor. This
// URL stays alive as a redirect (legacy URLs never dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/portals")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/sops", replace: true });
  },
});
