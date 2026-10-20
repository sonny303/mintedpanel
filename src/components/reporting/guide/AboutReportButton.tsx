// "About this report" — the info button every report header carries. It opens
// a right-side sheet with that report's guide article and its terms, plus a
// link to the full guide. The sheet is the stock Dialog primitive positioned
// against the right edge (no Sheet primitive ships in src/components/ui).
// Renders nothing when the viewer's audience may not read the article.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { BookOpen, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthStore } from "@/lib/auth-store";
import { guideAudienceFor, guideTermFor, reportsFor } from "@/lib/reportingGuide";
import { DraftChip, ReportArticleBody, TermCard } from "./GuideContent";

export function AboutReportButton({ reportKey }: { reportKey: string }) {
  const [open, setOpen] = useState(false);
  const audience = guideAudienceFor(useAuthStore((s) => s.accessContext?.audience));
  const entry = reportsFor(audience).find((e) => e.report.key === reportKey);
  if (!entry) return null;

  const terms = entry.article.relatedTerms.flatMap((id) => {
    const term = guideTermFor(id, audience);
    return term ? [term] : [];
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Info />
        About this report
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-testid="about-report-sheet"
          className="top-0 right-0 left-auto flex h-dvh w-full max-w-md translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l p-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 sm:max-w-lg sm:rounded-none"
        >
          <DialogHeader className="space-y-1 border-b border-border px-5 py-4 pr-12 text-left">
            <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              About this report
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="text-[16px] font-semibold">{entry.report.title}</DialogTitle>
              <DraftChip status={entry.article.reviewStatus} audience={audience} />
            </div>
            <DialogDescription className="text-[13px] text-muted-foreground">
              {entry.article.summary}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <ReportArticleBody entry={entry} audience={audience} compact />
            {terms.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-[14px] font-semibold text-foreground">Terms in this report</h3>
                {terms.map((term) => (
                  <TermCard key={term.id} term={term} audience={audience} showRelated={false} />
                ))}
              </section>
            ) : null}
          </div>
          <div className="border-t border-border px-5 py-3">
            <Button asChild variant="outline" size="sm">
              <Link to="/reporting/guide" search={{ topic: reportKey }}>
                <BookOpen />
                Open full guide
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
