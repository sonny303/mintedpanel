// E6.1 F6.1.6 (2026-07-19) — the MSO routing admin page retires from the nav
// and the URL redirects to the Payer Setup catalog; E6.5 re-encodes delegated
// paths as payer knowledge (delegation facts on catalog entries + payer SOPs)
// before the rules ENGINE itself retires. The mso_routing_rules data and the
// case-creation routing reads are untouched by this stub.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/mso-routing")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin", search: { tab: "catalog" }, replace: true });
  },
});
