// E6.1 F6.1.6 → E6.6 F6.6.2 — retired with the Launches surface; redirects
// to the Reporting Center Launches report (the parent /launches route throws
// the same redirect). Kept as a stub per the no-deleted-route-files rule.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/launches/$id")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting/launches", replace: true });
  },
});
