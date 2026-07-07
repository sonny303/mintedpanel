import { createFileRoute, Outlet } from "@tanstack/react-router";

// Legacy /admin/sops surface — the authoring UI moved to /admin/templates as a
// wizard. Kept only as a redirect shell so bookmarked SOPs URLs still resolve;
// the index and $id children below throw the redirect (a beforeLoad here would
// preempt the $id child's param-preserving redirect).
export const Route = createFileRoute("/admin/sops")({
  component: () => <Outlet />,
});
