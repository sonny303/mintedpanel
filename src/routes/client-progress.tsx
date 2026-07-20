// Owner-view retirement (E6.1 F6.1.6 → E6.6 F6.6.3): the Client Progress
// owner story is replaced by the Reporting Center's Denials report. This URL
// stays alive as a redirect (legacy URLs never dead-end; the URL had been
// shared with owners out-of-band).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/client-progress")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting/denials", replace: true });
  },
});
