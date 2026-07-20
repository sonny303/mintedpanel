// Owner-view consolidation (Jul 2026): /progress folded into /client-progress,
// which E6.6 F6.6.3 replaced with the Reporting Center Denials report — this
// redirects straight there instead of chaining. The URL had been shared with
// owners out-of-band (R1 findings P2) — it never 404s.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/progress")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting/denials", replace: true });
  },
});
