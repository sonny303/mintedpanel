import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/launches")({
  component: () => <Outlet />,
});
