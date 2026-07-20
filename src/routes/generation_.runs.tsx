// E2.4 F2.4.1 run history — RESTORED by E6.3 (the E6.1 interim redirect is
// superseded; run history is reachable from the grid and the board). The
// `generation_.` un-nesting idiom keeps these outside the /generation route's
// element tree.
import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/generation_/runs")({
  component: Outlet,
});
