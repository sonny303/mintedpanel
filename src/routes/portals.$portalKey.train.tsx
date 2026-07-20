// E6.1 F6.1.6 → E6.5: the standalone mapping-training deck retired; E6.5
// rebuilds training INSIDE the SOP form-step editor (same training ops over
// the same stores), so this lands on the SOPs tab. This URL stays alive as a
// redirect (legacy URLs never dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/portals/$portalKey/train")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/sops", replace: true });
  },
});
