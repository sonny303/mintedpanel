// Payer & Cases design bundle, screen 1 — the module landing is the
// single-view Payer Setup page (KPI filter cards + payer table + default-
// template card). The E6.5 catalog-tab composition (tab strip + readiness
// funnel + catalog browse) was superseded by Slice A, and Slice G folded the
// /sops authoring tab away, so this segment is the module's ONLY leaf beside
// the payer detail.
//
// Slice G renamed the segment `catalog` → `setup`: it was named for a catalog
// tab that no longer exists, and `setup` is the vocabulary the page header and
// the sidebar entry both already use ("Payer Setup"). Every inbound spelling
// still lands here — /admin/payer-admin (the ?tab= mapper), the old
// /admin/payer-admin/catalog, /admin/payer-admin/sops, /admin/payers,
// /payer-directory, and the six folded authoring URLs all redirect in.
import { createFileRoute } from "@tanstack/react-router";
import { PayerSetupPage } from "@/components/payer-admin/PayerSetupPage";

export const Route = createFileRoute("/admin/payer-admin/setup")({
  component: PayerSetupPage,
});
