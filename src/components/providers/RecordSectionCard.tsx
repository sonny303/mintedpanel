// 2026-07-21 provider-detail redesign — the shared section-card + add-button
// primitives the tabbed provider record composes. One card shape (white, 1px
// #E8E5E0 border, 6px radius, hairline-divided header) and ONE "+ Add" button
// style (primary forest green, leading + glyph, whitespace-nowrap) so every
// section header and every section-level add action is identical (handoff
// issues 1 & 7). Each card keeps its `id` + `#{id}-heading` so the roster's
// gap-pill deep-links (and the readiness fix-here anchors) still land here.
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RecordSectionCard({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  /** Right-aligned header slot — the section's primary action (Edit, + Add …). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-24 rounded-md border border-[#E8E5E0] bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E8E5E0] px-5 py-3">
        <h2 id={`${id}-heading`} className="text-[15px] font-semibold text-foreground">
          {title}
        </h2>
        {action ?? null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// The one "+ Add" affordance. `label` is passed WITHOUT the glyph; the "+ " is
// prepended into a single text node so the accessible name is "+ Add license"
// (keeps the leading "+" in the name — the existing e2e matches on it, and it
// disambiguates the section trigger from a dialog's "Add license" submit).
export function AddButton({
  label,
  onClick,
  disabled,
  className,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-[34px] whitespace-nowrap bg-[#1B4D3E] px-3.5 text-[13px] font-medium text-white hover:bg-[#163F33]",
        className,
      )}
    >
      {`+ ${label}`}
    </Button>
  );
}
