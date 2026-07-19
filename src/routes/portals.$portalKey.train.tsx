// E6.1 F6.1.6 (2026-07-19) — the standalone mapping-training deck retires
// toward the Payer Setup module; E6.5 rebuilds training INSIDE the SOP form
// step editor (same training ops over the same stores). Until then the Forms
// & portals tab is the nearest home for mapping state. The training hooks and
// pure confidence/dictionary logic (useMappingReview, mappingConfidence)
// remain for E6.5 to compose; the retired deck UI lives in git history. This
// URL stays alive as a redirect (legacy URLs never dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/portals/$portalKey/train")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payer-admin", search: { tab: "forms" }, replace: true });
  },
});
