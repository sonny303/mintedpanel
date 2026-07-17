// E4.2 unified payer setup (TE-18/TE-19) — Admin → Payers moved into the
// "Payer Setup" workspace at /admin/payer-admin: its e4-2c governance
// affordances (Minted-catalog vs Legacy source pills, the starter toggle,
// the read-only identity posture) live on the workspace's Setup tab, and the
// canonical add-a-payer path is the workspace's Catalog tab (also standalone
// at /payer-directory). This shell keeps old links alive (the
// /admin/sops → /admin/templates redirect precedent); non-admins land on the
// workspace's explicit denial state, which links the read-only catalog.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/payers")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin" });
  },
});
