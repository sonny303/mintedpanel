// E6.1 F6.1.4 (2026-07-19) — Account Detail renamed and slimmed into Org
// Detail at /org-detail; this URL stays alive as a redirect (the /portfolio
// precedent — legacy URLs never dead-end). The group/facility/roster
// summaries it used to render move toward the Groups item (E6.2; interim on
// the /groups shell).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/get-started")({
  beforeLoad: () => {
    throw redirect({ to: "/org-detail", replace: true });
  },
});
