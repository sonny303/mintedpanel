// 2026-07-20 UX-consistency handoff — THE one CSV-import disclosure. Every
// CSV entry point renders this collapsed-by-default panel (a labeled trigger
// with upload + chevron icons; expanding reveals instructions, template
// download(s), and the drop zone), standardizing on the pattern the group
// Payer Network board established — the import is a power-user tool that
// should never crowd out a page's primary content. Composition over
// duplication: children are the existing import content (RosterUploader or a
// gated variant); this wrapper owns ONLY the disclosure. Collapsed by
// default — but a surface with a resumable/finished run passes `defaultOpen`
// so the run's status and error report stay visible on return (F3.0.4).
// Stock shadcn Collapsible, token-styled (DESIGN-DEBT logged).
import { ChevronDown, Upload } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function CsvImportPanel({
  label,
  description,
  defaultOpen = false,
  children,
}: {
  /** The trigger text — also the panel's identity in tests ("Bulk provider
   * import", "Facility CSV import", "Attach payers from a CSV"). */
  label: string;
  /** Optional first line inside the expanded box. */
  description?: string;
  /** Start expanded — set when a run is waiting so its outcome isn't hidden. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
        <Upload className="h-3.5 w-3.5" aria-hidden />
        {label}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-3 rounded-md border border-[#E8E5E0] bg-[#FAFAF9] p-4">
          {description ? <p className="text-[12px] text-muted-foreground">{description}</p> : null}
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
