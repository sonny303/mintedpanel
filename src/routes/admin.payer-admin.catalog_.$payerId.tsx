// Payer & Cases design bundle, screen 3 (Slice C) — the payer drill-in, now
// the TABBED, editable detail. Un-nested from the catalog segment (the
// `catalog_` idiom, like generation_.runs) so it renders as its own page.
// Renders for ALL roles (E6.1 interim posture); every write affordance inside
// self-gates to admin and the RLS/RPC layer backstops it.
//
// The active tab is URL state (`?tab=`) so a tab is shareable and the folded
// scorecard route can redirect straight into it (§2.10). `?edit=1` opens the
// Overview identity editor immediately — how the retired standalone edit page
// keeps its INTENT (§2.11), not just its URL.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PayerDetailPage } from "@/components/payer-admin/PayerDetailPage";
import { parsePayerDetailTab, type PayerDetailTab } from "@/lib/payerDetailView";

// Both params are OPTIONAL: every existing link to this payer (the catalog
// browser, Payer Setup, the case header, the near-match "use this one"
// hand-off) navigates without search, and a bare URL must keep working. The
// route normalizes — an unknown tab reads as Overview.
interface PayerDetailSearch {
  tab?: PayerDetailTab;
  edit?: boolean;
}

export const Route = createFileRoute("/admin/payer-admin/catalog_/$payerId")({
  validateSearch: (search: Record<string, unknown>): PayerDetailSearch => {
    const out: PayerDetailSearch = {};
    if (search.tab !== undefined) out.tab = parsePayerDetailTab(search.tab);
    if (search.edit === true || search.edit === "true" || search.edit === "1") out.edit = true;
    return out;
  },
  component: PayerDetailRoute,
});

function PayerDetailRoute() {
  const { payerId } = Route.useParams();
  const { tab, edit } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <PayerDetailPage
      payerId={payerId}
      tab={tab ?? "overview"}
      startEditing={edit === true}
      onTabChange={(next) =>
        navigate({
          to: "/admin/payer-admin/catalog/$payerId",
          params: { payerId },
          search: { tab: next },
          replace: true,
        })
      }
    />
  );
}
