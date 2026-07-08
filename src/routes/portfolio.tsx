// Portfolio route (redesign E0.0, feature F0.0.5). The cross-org home: renders
// without requiring an active org. The chrome-decoupled PortfolioContent brings
// its own data; this route only wraps it in the shell's PageHeader (the
// AppShell frame itself comes from __root).
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { PortfolioContent } from "@/components/portfolio/PortfolioContent";

export const Route = createFileRoute("/portfolio")({
  component: PortfolioPage,
});

function PortfolioPage() {
  return (
    <div>
      <PageHeader title="Portfolio" description="Your organizations across the business." />
      <PortfolioContent />
    </div>
  );
}
