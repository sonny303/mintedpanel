import { createFileRoute, redirect } from "@tanstack/react-router";

// The old single-page SOP builder was replaced by the /admin/templates wizard.
// Redirect bookmarked editor URLs, preserving the id so a deep-linked template
// still opens in the wizard.
export const Route = createFileRoute("/admin/sops/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/admin/templates/$id", params });
  },
});
