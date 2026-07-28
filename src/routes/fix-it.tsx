// E6.5 F6.5.4 → Slice G — the Fix-it deck retired outright: drift repair lives
// inside the Template Editor (queue-first broken mappings), surfaced by the
// Sidebar drift badge and the Payer Setup page's "Drift detected" KPI card.
// Provider data gaps moved to the E6.4 roster gap pills; dictionary confirms
// fold into the trainer's suggestions. Slice G folded the interim SOPs tab, so
// this lands on Payer Setup. Legacy URLs never dead-end.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/fix-it")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/setup", replace: true });
  },
});
