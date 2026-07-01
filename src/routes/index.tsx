// Public landing placeholder for `/`.
// Renders regardless of auth state so logged-out visitors see content.
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: LandingPlaceholder,
});

function LandingPlaceholder() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background text-[13px] text-foreground">
      Public landing page — placeholder
    </div>
  );
}
