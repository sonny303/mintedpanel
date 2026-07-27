// Payer & Cases design bundle, screen 1 (Slice A) — the module landing is the
// single-view Payer Setup page (KPI filter cards + payer table + default-
// template card). The E6.5 catalog-tab composition (tab strip + readiness
// funnel + catalog browse) is superseded HERE; the /sops segment keeps its
// authoring surface as a legacy URL until Slice G folds it. The `catalog`
// segment name is stale by design — the route RENAME is Slice G's (never
// break inbound links; /admin/payers, /payer-directory, and the ?tab=
// spellings all still land here).
import { createFileRoute } from "@tanstack/react-router";
import { PayerSetupPage } from "@/components/payer-admin/PayerSetupPage";

export const Route = createFileRoute("/admin/payer-admin/catalog")({
  component: PayerSetupPage,
});
