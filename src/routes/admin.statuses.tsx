// E6.0 F6.0.1 — the Admin › Statuses configuration page is RETIRED (page
// retired, E6.0): the case status list is fixed and code-owned
// (src/lib/caseStatus.ts) and no per-org status CRUD exists anywhere. The
// route redirects (the /portfolio precedent — legacy URLs never dead-end);
// E6.1 owns the wholesale nav/redirect table and may re-point this stub.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/statuses")({
  beforeLoad: () => {
    throw redirect({ to: "/cases", replace: true });
  },
});
