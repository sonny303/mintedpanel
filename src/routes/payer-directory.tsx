// E6.1 F6.1.6 (2026-07-19) — the standalone Payer Directory page retires into
// the Payer Setup workspace's Catalog tab (the same shared PayerCatalogBrowser
// body). Payer Setup renders for ALL roles under the interim posture
// (F6.1.1), so the non-admin read-only browse this URL used to serve is
// preserved at the destination. This URL stays alive as a redirect.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/payer-directory")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin", search: { tab: "catalog" }, replace: true });
  },
});
