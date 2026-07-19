// Owner-view consolidation (Jul 2026): /progress folded into /client-progress.
// E6.1 F6.1.6 (2026-07-19): that surface is itself deprecated toward the
// Reporting Center (E6.6 lands the report), so this redirects straight there
// instead of chaining through the retired page. The URL had been shared with
// owners out-of-band (R1 findings P2) — it never 404s.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/progress")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting", replace: true });
  },
});
