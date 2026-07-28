// §2.11 EDITABLE IN PLACE (Slice C) — Payer Detail now edits identity on the
// page itself (Overview → "Edit payer" swaps in the SAME Slice B
// PayerDetailsForm), so the standalone edit page is no longer a second door.
// This shell keeps Slice B's URL alive AND preserves its INTENT: it redirects
// into the detail's Overview with `edit=1`, which opens the form straight away
// instead of dropping the visitor on a read-only card.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/payers_/$id/edit")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/admin/payer-admin/setup/$payerId",
      params: { payerId: params.id },
      search: { tab: "overview", edit: true },
      replace: true,
    });
  },
});
