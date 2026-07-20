// E6.1 F6.1.6 → E6.6 F6.6.2: the Launches list/detail retired; the launch
// read lives on as the Reporting Center Launches report. Legacy URLs never
// dead-end — this parent redirect covers /launches and every child.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/launches")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting/launches", replace: true });
  },
});
