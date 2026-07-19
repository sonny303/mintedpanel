// E6.1 F6.1.6 (2026-07-19) — retired with the /generation surface; the
// parent generation_.runs route throws the redirect. Kept as a stub per the
// no-deleted-route-files rule.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/generation_/runs/")({
  beforeLoad: () => {
    throw redirect({ to: "/groups", replace: true });
  },
});
