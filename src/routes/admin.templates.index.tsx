// E6.1 F6.1.6 → Slice G — the standalone Templates list page retired into the
// Payer Setup module, and Slice G folded the SOPs tab that briefly hosted it
// (TemplatesList is deleted). A payer's templates now live on the payer
// detail's Templates tab and the payerless default on the Payer Setup card,
// so bookmarked list URLs land on Payer Setup. The wizard sub-routes
// (/admin/templates/new and /admin/templates/$id) KEEP rendering — they are
// the Slice F Template Editor, the one authoring home.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/templates/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/setup", replace: true });
  },
});
