// Redesign E0.6 (TE-3): the Portfolio moved into the Reporting Center. The bare
// /portfolio path stays alive as a redirect so no bookmark or old redirect
// dead-ends (E0.4 "no dead-ends" / TD-1). The surface itself now lives at
// /reporting/portfolio; PortfolioContent + splitPortfolio are unchanged.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/portfolio")({
  beforeLoad: () => {
    throw redirect({ to: "/reporting/portfolio", replace: true });
  },
});
