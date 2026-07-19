// E6.1 F6.1.6 (2026-07-19) — the internal /admin/import surface retires;
// imports live with the data they create (F6.1.6: "imports live with data").
// The three per-section staged uploads remain available beside the manual
// forms in the wizard sections (E3.3), and in-flight runs stay reviewable at
// /import/$runId; E6.4's Providers area carries imports forward. This URL
// stays alive as a redirect (legacy URLs never dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/import")({
  beforeLoad: () => {
    throw redirect({ to: "/providers", replace: true });
  },
});
