// E6.4 F6.4.2 — the monolithic provider edit form is RETIRED (it carried the
// assignment-wipe defect: it passed facilityIds: [] into a save path that
// never synced assignments). Every field now edits inline on the record with
// single-field audited writes; assignments are managed in place. The URL
// stays alive as a redirect so old links never dead-end.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/providers/$id/edit")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/providers/$id", params: { id: params.id }, replace: true });
  },
});
