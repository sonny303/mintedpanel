// §2.10 SCORECARD FOLD (Slice C) — the standalone payer scorecard page is
// folded into the Payer Detail's Scorecard tab (one scorecard, not two). Its
// body moved verbatim to components/payer-admin/PayerScorecardPanel.tsx,
// including the admin-&-billing gate; this shell keeps every old link alive by
// redirecting into the tab (the /admin/sops → /admin/templates precedent).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/payers_/$id/scorecard")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/admin/payer-admin/catalog/$payerId",
      params: { payerId: params.id },
      search: { tab: "scorecard" },
      replace: true,
    });
  },
});
