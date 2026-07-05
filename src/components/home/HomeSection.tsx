// Home queue section card (M5, extracted in the Home polish pass): header
// with title + tabular count and an always-on "view all" slot; empty sections
// collapse to the one-line clear state so a quiet day reads as a short list.
import type { ReactNode } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";

interface HomeSectionProps {
  title: string;
  /** Full section size — may exceed the rows rendered (sections cap at 10). */
  count: number;
  /** "View all" link for the section, built by the page (typed per target). */
  viewAll?: ReactNode;
  children: ReactNode;
}

export function HomeSection({ title, count, viewAll, children }: HomeSectionProps) {
  if (count === 0) {
    return (
      <div className="px-4 py-2.5 text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)] border border-mp-border rounded-[var(--mp-radius-lg)] bg-mp-card">
        {title} — clear
      </div>
    );
  }
  return (
    <section className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-mp-border bg-mp-muted/60 px-4 py-2.5">
        <span className="text-[length:var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
          {title}
          <span className="ml-2 tabular-nums text-[length:var(--mp-text-xs)] font-medium text-[color:var(--mp-ink-faint)]">
            {count}
          </span>
        </span>
        {viewAll}
      </div>
      {children}
    </section>
  );
}

export function HomeViewAllLink(props: LinkProps) {
  return (
    <Link
      {...props}
      className="whitespace-nowrap text-[length:var(--mp-text-xs)] font-medium text-[color:var(--mp-primary)] hover:underline"
    >
      View all
    </Link>
  );
}
