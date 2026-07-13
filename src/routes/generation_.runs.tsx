// E2.4 — run-history parent (renders only <Outlet/>, the routing rule). The
// `generation_` prefix un-nests these from /generation's component (the
// admin.payers_.$id precedent) while keeping the /generation/runs URL —
// reached from the generation surface, no nav item ([r4-review] Q10).
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/generation_/runs")({
  component: Outlet,
});
