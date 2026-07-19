// E6.1 F6.1.6 (2026-07-19) — the standalone Fix-it queue page retires; the
// deck now lives on the Payer Setup workspace's "Needs attention" tab
// (src/components/fixit/FixitDeck.tsx, extracted intact) until E6.5's
// drift-repair-in-the-editor supersedes it. This URL stays alive as a
// redirect (legacy URLs never dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/fix-it")({
  beforeLoad: () => {
    throw redirect({
      to: "/admin/payer-admin",
      search: { tab: "needs-attention" },
      replace: true,
    });
  },
});
