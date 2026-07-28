// E6.5 F6.5.1 → Slice G — the ?tab= workspace was superseded by real URL
// segments, and Slice G folded /sops away and renamed the stale `catalog`
// segment to `setup`. This index is the redirect mapper so every legacy
// ?tab= deep link (and the bare module URL) lands on its successor — legacy
// URLs never dead-end:
//   (none) | setup | catalog | templates | forms | needs-attention
//                                      → /admin/payer-admin/setup
//   org-settings                       → /org-detail (org data left the module)
// The old ?payerId= Forms-tab context (register-portal preselect) is dropped:
// portal registration lives inside the SOP form step since E6.5.
import { createFileRoute, redirect } from "@tanstack/react-router";

const LEGACY_TABS = [
  "setup",
  "catalog",
  "templates",
  "forms",
  "needs-attention",
  "org-settings",
] as const;
type LegacyTab = (typeof LEGACY_TABS)[number];

interface PayerAdminSearch {
  tab?: LegacyTab;
  payerId?: string;
}

export const Route = createFileRoute("/admin/payer-admin/")({
  validateSearch: (search: Record<string, unknown>): PayerAdminSearch => ({
    tab: LEGACY_TABS.includes(search.tab as LegacyTab) ? (search.tab as LegacyTab) : undefined,
    payerId: typeof search.payerId === "string" ? search.payerId : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.tab === "org-settings") {
      throw redirect({ to: "/org-detail", replace: true });
    }
    throw redirect({ to: "/admin/payer-admin/setup", replace: true });
  },
});
