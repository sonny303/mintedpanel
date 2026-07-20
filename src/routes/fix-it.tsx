// E6.5 F6.5.4 — the Fix-it deck retires outright: drift repair now lives
// inside the SOP editor (queue-first broken mappings), surfaced by the Sidebar
// drift badge and the Payer Setup SOPs tab's repair banners. Provider data
// gaps moved to the E6.4 roster gap pills; dictionary confirms fold into the
// trainer's suggestions. This URL stays alive as a redirect (legacy URLs never
// dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/fix-it")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/sops", replace: true });
  },
});
