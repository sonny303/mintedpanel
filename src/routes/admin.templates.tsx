import { createFileRoute, Outlet } from "@tanstack/react-router";

// Legacy /admin/templates surface — renamed to /admin/sops (P1). Kept only as a
// redirect shell so bookmarked Templates URLs still resolve; the index and $id
// children below throw the redirect (a beforeLoad here would preempt the $id
// child's param-preserving redirect).
export const Route = createFileRoute("/admin/templates")({
  component: () => <Outlet />,
});
