// E4.2 F4.2.1 / TE-1 — the Payer & SOP admin module is a bounded, role-gated
// route subtree inside the existing app (NOT a separate deployment). This parent
// only renders the nested surface; every leaf self-gates to admin at render
// time (the beforeLoad store is empty on hard-load — see the codebase wart).
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/payer-admin")({
  component: () => <Outlet />,
});
