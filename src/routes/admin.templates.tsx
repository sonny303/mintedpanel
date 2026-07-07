import { createFileRoute, Outlet } from "@tanstack/react-router";

// Admin > Templates — the SOP template authoring surface (list + wizard).
// Children: index (list), new (create wizard), $id (edit wizard).
export const Route = createFileRoute("/admin/templates")({
  component: () => <Outlet />,
});
