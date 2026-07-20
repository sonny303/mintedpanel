// 2026-07-20 catalog UX pass (item 8) — the read-only payer drill-in behind
// the Payer Setup catalog list. Un-nested from the catalog segment (the
// `catalog_` idiom, like generation_.runs) so it renders as its own page, not
// inside the tab layout. Renders for ALL roles like the catalog itself (E6.1
// interim posture); the network actions inside self-gate to admin and the
// RLS/RPC layer backstops every write.
import { createFileRoute } from "@tanstack/react-router";
import { PayerDetailContent } from "@/components/payers/PayerDetailContent";

export const Route = createFileRoute("/admin/payer-admin/catalog_/$payerId")({
  component: PayerDetailPage,
});

function PayerDetailPage() {
  const { payerId } = Route.useParams();
  return <PayerDetailContent payerId={payerId} />;
}
