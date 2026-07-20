// E6.1 F6.1.6 (2026-07-19) — the reserved E0.0 "Outcomes" journey slot
// retires; outcome views live in the Reporting Center (E6.6 grows the report
// set). This URL stays alive as a redirect (legacy URLs never dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/outcomes")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting", replace: true });
  },
});
