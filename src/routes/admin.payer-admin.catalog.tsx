// Slice G — the stale `catalog` segment is renamed to `setup` (it was named
// for a catalog tab Slice A superseded). This shell keeps every bookmarked
// /admin/payer-admin/catalog link alive, the /admin/sops → /admin/templates
// precedent. Legacy URLs never dead-end.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/payer-admin/catalog")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/setup", replace: true });
  },
});
