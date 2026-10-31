// Locations per Group folded into the Portfolio (Oct 20 review, RC-05): each
// group row there carries its active-location count. The old URL stays alive
// as a redirect so no bookmark dead-ends.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/reporting/locations-per-group")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting/portfolio", replace: true });
  },
});
