// E6.1 F6.1.6 (2026-07-19) — the Launches list/detail retire; the launch view
// returns as a Reporting Center Launches report in E6.6 (locations themselves
// are edited in the wizard Facilities section / the Groups surfaces). Until
// that report lands the nearest home is the Reporting Center index. Legacy
// URLs never dead-end — this parent redirect covers /launches and every child.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/launches")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting", replace: true });
  },
});
