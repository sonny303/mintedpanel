// Slice G — the payer drill-in moved with its parent segment (catalog →
// setup). This shell keeps every bookmarked /admin/payer-admin/catalog/
// $payerId link alive AND carries its state through: `?tab=` (the Slice C
// shareable tab, also how the folded scorecard route lands) and `?edit=1`
// (the retired standalone edit page's intent). Dropping either would break
// those two redirects, so both are re-validated here and forwarded.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { parsePayerDetailTab, type PayerDetailTab } from "@/lib/payerDetailView";

interface LegacyPayerDetailSearch {
  tab?: PayerDetailTab;
  edit?: boolean;
}

export const Route = createFileRoute("/admin/payer-admin/catalog_/$payerId")({
  validateSearch: (search: Record<string, unknown>): LegacyPayerDetailSearch => {
    const out: LegacyPayerDetailSearch = {};
    if (search.tab !== undefined) out.tab = parsePayerDetailTab(search.tab);
    if (search.edit === true || search.edit === "true" || search.edit === "1") out.edit = true;
    return out;
  },
  beforeLoad: ({ params, search }) => {
    // The search FUNCTION form is required: passing the validated object
    // through carries the raw query string verbatim, so a legacy `?edit=1`
    // would propagate into the new URL space forever. Returning a fresh
    // object makes the router serialize the canonical spelling.
    throw redirect({
      to: "/admin/payer-admin/setup/$payerId",
      params: { payerId: params.payerId },
      search: () => ({
        ...(search.tab ? { tab: search.tab } : {}),
        ...(search.edit ? { edit: true } : {}),
      }),
      replace: true,
    });
  },
});
