// E6.1 F6.1.6 (2026-07-19) — the shared reserved-slot route retires with the
// last reserved nav items (the six-item sidebar has none). Old ?title= links
// land on the Reporting Center, the shared not-yet-available state's own
// long-standing pointer. This URL stays alive as a redirect (legacy URLs
// never dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/soon")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting", replace: true });
  },
});
