// Mission Control page chrome, rendered once by the layout route above every
// section: a route-derived breadcrumb (Mission Control › section), the page
// header, and the horizontal section navigation. The sections are the closed
// set in src/lib/missionControl.ts; the strip renders only once that set has
// two or more entries (Home alone needs no navigation). The section nav is a
// composition of the stock shadcn Button (ghost, asChild over a router Link)
// styled with --mp-* tokens to match the TabsList strip; logged in
// DESIGN-DEBT.md.
//
// A router Link marks itself current (aria-current="page") whenever its path
// is a PREFIX of the location, so every link to /mission-control matches
// exactly, and on Home the root crumb is plain text: exactly one element per
// nav is ever the current page.
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  MISSION_CONTROL_PATH,
  MISSION_CONTROL_SECTIONS,
  missionControlSection,
} from "@/lib/missionControl";
import { cn } from "@/lib/utils";

export function MissionControlHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = missionControlSection(pathname);
  const onHome = current.to === MISSION_CONTROL_PATH;
  const showSections = MISSION_CONTROL_SECTIONS.length > 1;

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-[12.5px]">
        {onHome ? (
          <span className="text-muted-foreground">Mission Control</span>
        ) : (
          <Link
            to="/mission-control"
            activeOptions={{ exact: true }}
            className="text-muted-foreground hover:text-foreground"
          >
            Mission Control
          </Link>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span aria-current="page" className="font-medium text-foreground">
          {current.label}
        </span>
      </nav>
      <PageHeader title={current.title} description={current.description} />
      {showSections ? (
        <nav
          aria-label="Mission Control sections"
          className="-mt-2 flex w-fit max-w-full flex-wrap gap-[2px] rounded-[var(--mp-radius-sm)] bg-[var(--mp-muted)] p-[3px]"
        >
          {MISSION_CONTROL_SECTIONS.map((section) => {
            const active = section.to === current.to;
            return (
              <Button
                key={section.to}
                asChild
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 rounded-[var(--mp-radius-control)] border px-3 text-[13px]",
                  active
                    ? "border-[var(--mp-border)] bg-[var(--mp-card)] text-foreground hover:bg-[var(--mp-card)]"
                    : "border-transparent text-muted-foreground hover:bg-transparent hover:text-foreground",
                )}
              >
                <Link
                  to={section.to}
                  activeOptions={{ exact: section.to === MISSION_CONTROL_PATH }}
                  aria-current={active ? "page" : undefined}
                >
                  {section.label}
                </Link>
              </Button>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
