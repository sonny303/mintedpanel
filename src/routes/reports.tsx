// 3M Slice 2 (2026-08-09) — the pre-redesign /reports tab switcher retires to
// the Reporting Center. Its five tabs predate the E6.6 grouped index and were
// unreachable from the six-item sidebar: nothing in the app linked here, so the
// URL was reachable only by hand or from an old bookmark. Those land on
// /reporting now (legacy URLs never dead-end, the E0.4 rule).
//
// The ?tab= param is deliberately dropped — the Center is a report REGISTRY
// (src/lib/reports.ts), not a tab strip, so there is no destination tab to
// carry it to. Same call as /admin/portals?payerId= when its tab retired.
//
// src/components/reports/* is intentionally NOT deleted here: re-homing those
// reports into the Center is a registry entry + a route each, and that is a
// product call, not a cleanup one.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/reports")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting", replace: true });
  },
});
