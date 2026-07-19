// E6.1 F6.1.6 (2026-07-19) — the Client Progress owner view is deprecated;
// its job (owner-readable progress) re-homes as a Reporting Center report in
// E6.6. Until that report lands the nearest home is the Reporting Center
// index. This URL stays alive as a redirect (the /portfolio precedent —
// legacy URLs never dead-end; the URL had been shared with owners
// out-of-band).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/client-progress")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting", replace: true });
  },
});
