// E6.1 F6.1.6 (2026-07-19) — retired with the /generation surface (see
// generation.tsx); E6.2/E6.3 re-home run history with the generation door.
// This parent redirect covers /generation/runs and the $runId child.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/generation_/runs")({
  beforeLoad: () => {
    throw redirect({ to: "/groups", replace: true });
  },
});
