// E6.1 F6.1.6 → E6.5 F6.5.5: MSO routing retired outright — delegation is a
// curated payer-catalog fact (payers.delegation_note, rendered in the catalog
// browse) plus SOP content, not a routing engine. The msos/mso_routing_rules
// tables stay dormant per the additive rule (both live-verified at 0 rows).
// This URL stays alive as a redirect (legacy URLs never dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/mso-routing")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/setup", replace: true });
  },
});
