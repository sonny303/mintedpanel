// Layout route for /providers/$id. Renders <Outlet /> so child routes
// (index detail view, edit form) can mount.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/providers/$id")({
  component: () => <Outlet />,
});
