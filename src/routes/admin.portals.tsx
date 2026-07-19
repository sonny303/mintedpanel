// E6.1 F6.1.6 (2026-07-19) — the standalone Portals registry page retires
// into the Payer Setup workspace's "Forms & portals" tab (the same shared
// PortalsRegistry body). The ?payerId= payer-context deep link (the setup
// funnel's "Register portal" action) is preserved through the redirect.
// E6.5 folds portal registration/capture/train into the SOP form step.
import { createFileRoute, redirect } from "@tanstack/react-router";

interface PortalsSearch {
  payerId?: string;
}

export const Route = createFileRoute("/admin/portals")({
  validateSearch: (search: Record<string, unknown>): PortalsSearch => ({
    payerId: typeof search.payerId === "string" ? search.payerId : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/admin/payer-admin",
      search: { tab: "forms", ...(search.payerId ? { payerId: search.payerId } : {}) },
      replace: true,
    });
  },
});
