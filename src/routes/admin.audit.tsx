// E6.6 F6.6.4 — the Audit Log admin page retired into the Reporting Center's
// Compliance group (same read surface, relocated; the append-only ledger is
// untouched). Legacy URLs never dead-end — this redirect shell keeps the old
// address alive (the /admin/sops precedent).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/audit")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting/audit-log", replace: true });
  },
});
