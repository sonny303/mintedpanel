// E6.1 F6.1.2 (2026-07-19) — Home is retired: the login landing is the Cases
// surface and the /home action queues are superseded by the Cases to-do pivot
// (the E2.3 ranked queue). The "Launches at risk" slice returns as a
// Reporting Center report in E6.6. This URL stays alive as a redirect (the
// /portfolio precedent — legacy URLs never dead-end).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/home")({
  beforeLoad: () => {
    throw redirect({ to: "/cases", replace: true });
  },
});
