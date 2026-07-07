import { createFileRoute, redirect } from "@tanstack/react-router";

// Renamed to /admin/sops/$id (P1). Redirect bookmarked editor URLs, preserving
// the id so a deep-linked SOP still opens.
export const Route = createFileRoute("/admin/templates/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/admin/sops/$id", params });
  },
});
