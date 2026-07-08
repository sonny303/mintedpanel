// Shared "not yet available" empty state (redesign E0.0, feature F0.0.6 +
// routing requirement). ONE composition component reused by every reserved
// Stage 1+ nav slot so they read consistently — the PM-approved exception to
// the "no new component" rule (OQ-3 sign-off, 2026-07-08). Assembled ONLY from
// existing primitives (card + text + button) and a lucide icon; it introduces
// no new primitive and no new styling system.
//
// It always proposes the next action (return to the Portfolio) rather than
// showing a blank region.
import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export function NotYetAvailable({ title }: { title: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Clock className="h-5 w-5" />
        </div>
        <div>
          <div className="text-[15px] font-semibold text-foreground">
            {title} isn't available yet
          </div>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            This part of the workspace is coming in a later release. Your Portfolio is ready now.
          </p>
        </div>
        <Link to="/portfolio" className={buttonVariants({ variant: "outline" })}>
          Go to Portfolio
        </Link>
      </CardContent>
    </Card>
  );
}
