// Owner-view consolidation (Jul 2026): the M5.5 owner view that lived here
// was folded into /client-progress. The /progress URL had been shared with
// owners out-of-band (R1 findings P2), so it redirects instead of 404ing.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/progress")({
  beforeLoad: () => {
    throw redirect({ to: "/client-progress" });
  },
});
