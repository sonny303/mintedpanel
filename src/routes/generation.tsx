// E6.1 F6.1.6 (2026-07-19) — the standalone generation surface retires;
// generation re-homes on the group's Payer Network board (E6.2 board, E6.3
// decoupled one-door generation reusing the existing machinery). Until those
// land, the Groups shell (carrying the payer-network pointer) is the interim
// home. The generation components/services/ledgers are untouched — E6.3
// re-triggers them. This URL stays alive as a redirect (legacy URLs never
// dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

interface GenerationSearch {
  // Kept so typed in-app links carrying the E4.2 payer/group scope still
  // compile; the interim /groups shell has no scoped view to hand them to.
  payerId?: string;
  groupId?: string;
}

export const Route = createFileRoute("/generation")({
  validateSearch: (search: Record<string, unknown>): GenerationSearch => ({
    payerId: typeof search.payerId === "string" ? search.payerId : undefined,
    groupId: typeof search.groupId === "string" ? search.groupId : undefined,
  }),
  beforeLoad: () => {
    throw redirect({ to: "/groups", replace: true });
  },
});
