// E6.1 F6.1.6 → E6.5 → Slice G: the standalone mapping-training deck retired;
// E6.5 rebuilt training INSIDE the SOP form-step editor (same training ops
// over the same stores), and Slice G folded the interim SOPs tab, so this
// lands on Payer Setup. Legacy URLs never dead-end.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/portals/$portalKey/train")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/setup", replace: true });
  },
});
