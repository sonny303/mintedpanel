// E6.1 F6.1.6 → E6.5: the standalone Payer Directory retired into the Payer
// Setup workspace's catalog area — now a real segment. This URL stays alive
// as a redirect (legacy URLs never dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/payer-directory")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin/catalog", replace: true });
  },
});
