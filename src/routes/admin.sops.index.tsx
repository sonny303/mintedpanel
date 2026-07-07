import { createFileRoute, redirect } from "@tanstack/react-router";

// Authoring moved to /admin/templates (wizard). Redirect bookmarked list URLs.
export const Route = createFileRoute("/admin/sops/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/templates" });
  },
});
