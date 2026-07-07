import { createFileRoute, redirect } from "@tanstack/react-router";

// Renamed to /admin/sops (P1). Redirect bookmarked list URLs.
export const Route = createFileRoute("/admin/templates/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/sops" });
  },
});
