// E6.1 F6.1.6 (2026-07-19) — the standalone Templates list page retires into
// the Payer Setup workspace's "SOP templates" tab (the same shared
// TemplatesList body). The wizard sub-routes (/admin/templates/new and
// /admin/templates/$id) KEEP rendering — they are the tab's working
// authoring flow until E6.5 folds authoring into the module; retiring them
// now would leave SOP authoring with no home.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/templates/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/sops", replace: true });
  },
});
