// Slice G — the SOPs authoring tab is FOLDED. The design bundle removes it
// outright (screen 1 is "a single list with no tabs"): a payer's templates now
// live on the payer detail's Templates tab, the payerless default template on
// the Payer Setup card, and authoring itself in the Slice F Template Editor
// (/admin/templates/new · /admin/templates/$id). Drift is a Payer Setup KPI
// card ("Drift detected") — the standalone repair banner is on the bundle's
// "do not re-add" list, and the drift derivation (useFormDrift) is untouched.
//
// This shell keeps the URL alive. The six folded authoring sources (/fix-it,
// /admin/portals, /portals/$key/train, /admin/templates, /admin/payer-admin/
// forms/$payerId, and the ?tab= mapper) used to land here; they now point
// straight at /admin/payer-admin/setup, so nothing chains through this shell.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/payer-admin/sops")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/setup", replace: true });
  },
});
