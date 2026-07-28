import { createFileRoute, redirect } from "@tanstack/react-router";

// Authoring moved to /admin/templates (the Slice F Template Editor), whose
// list itself retired into the Payer Setup module — redirect bookmarked list
// URLs straight to Payer Setup instead of chaining through the retired tabs.
export const Route = createFileRoute("/admin/sops/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/setup", replace: true });
  },
});
