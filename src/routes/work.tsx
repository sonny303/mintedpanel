// E6.1 F6.1.3 (2026-07-19) — "My Cases" (/work) merged into the ONE Cases
// surface at /cases (the ranked to-do queue is its default pivot). This URL
// stays alive as a redirect (the /portfolio precedent — legacy URLs never
// dead-end), preserving the post-generation ?run= batch banner.
import { createFileRoute, redirect } from "@tanstack/react-router";

interface WorkSearch {
  run?: string;
}

export const Route = createFileRoute("/work")({
  validateSearch: (search: Record<string, unknown>): WorkSearch => ({
    run: typeof search.run === "string" && search.run ? search.run : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/cases", search: search.run ? { run: search.run } : {}, replace: true });
  },
});
