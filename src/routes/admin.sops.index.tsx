import { createFileRoute, redirect } from "@tanstack/react-router";

// Authoring moved to /admin/templates (wizard), whose list itself retired
// into the Payer Setup workspace (E6.1 F6.1.6, 2026-07-19) — redirect
// bookmarked list URLs straight to the SOP templates tab instead of chaining.
export const Route = createFileRoute("/admin/sops/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin", search: { tab: "templates" }, replace: true });
  },
});
