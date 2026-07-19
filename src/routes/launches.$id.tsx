// E6.1 F6.1.6 (2026-07-19) — retired with the Launches surface; the parent
// /launches route throws the redirect (Reporting Center until the E6.6
// Launches report lands). Kept as a stub per the no-deleted-route-files rule.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/launches/$id")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting", replace: true });
  },
});
