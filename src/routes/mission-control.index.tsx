// Mission Control › Home: the cross-org count tiles. The layout route
// (mission-control.tsx) owns the guard, breadcrumb and section navigation.
import { createFileRoute } from "@tanstack/react-router";
import { MetricsGrid } from "@/components/mission-control/MetricsGrid";

export const Route = createFileRoute("/mission-control/")({
  component: MetricsGrid,
});
