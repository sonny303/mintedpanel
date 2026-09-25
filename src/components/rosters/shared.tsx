import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, FileClock, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function RosterPageFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Link
        to="/reporting"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Reporting Center
      </Link>
      <PageHeader title={title} description={description} />
      {children}
    </div>
  );
}

export function RosterLoading() {
  return (
    <div className="space-y-2" aria-label="Loading roster engine">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-5/6" />
      <Skeleton className="h-10 w-2/3" />
    </div>
  );
}

export function RosterError({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : "The roster request failed.";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 p-4 text-[13px]">
      <div className="flex items-start gap-2 text-destructive">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{message}</span>
      </div>
      {retry ? (
        <Button variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function NoRosterOrganization() {
  return <EmptyState message="Select an organization to work with provider roster data." />;
}

export function RosterEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-border px-4 py-8 text-center">
      <FileClock className="h-5 w-5 text-muted-foreground" />
      <p className="text-[13px] font-medium">{title}</p>
      <p className="max-w-lg text-[12px] text-muted-foreground">{description}</p>
    </div>
  );
}

export function RosterStatus({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warning" | "success" | "danger";
}) {
  const toneClass = {
    neutral: "border-border text-muted-foreground",
    warning: "border-border bg-[var(--mp-warn-tint)] text-[var(--mp-warn-ink)]",
    success: "border-border bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)]",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${toneClass}`}
    >
      {children}
    </span>
  );
}
