// Brief 2026-10-27 — "nothing disappears silently": the expected pairs that
// never became grid rows and that the skip banner doesn't already name. Each
// line carries ONE reason and ONE fix link; the links navigate in place, so
// browser Back returns to this exact scoped view (the scope lives in the URL)
// and the preview recomputes from the fixed data.
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { GenerationBlock, GenerationBlockers } from "@/lib/generationBlockers";

export function GenerationFixLink({ block }: { block: GenerationBlock }) {
  const className = "ml-auto text-[12px] text-primary underline-offset-2 hover:underline";
  const { fix } = block;
  switch (fix.kind) {
    case "provider":
      return (
        <Link to="/providers/$id" params={{ id: fix.providerId }} className={className}>
          {block.fixLabel}
        </Link>
      );
    case "groupFacts":
      return (
        <Link to="/groups/$groupId" params={{ groupId: fix.groupId }} className={className}>
          {block.fixLabel}
        </Link>
      );
    case "groupPayers":
      return (
        <Link
          to="/groups/$groupId/payer-network"
          params={{ groupId: fix.groupId }}
          className={className}
        >
          {block.fixLabel}
        </Link>
      );
    case "payerSetup":
      return (
        <Link
          to="/admin/payer-admin/setup/$payerId"
          params={{ payerId: fix.payerId }}
          search={fix.edit ? { edit: true } : fix.tab === "manage" ? { tab: "manage" } : {}}
          className={className}
        >
          {block.fixLabel}
        </Link>
      );
  }
}

function names(list: readonly string[], max = 3): string {
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} and ${list.length - max} more`;
}

export function GenerationBlockersPanel({ blockers }: { blockers: GenerationBlockers }) {
  const { outOfState, setup, archivedPayers } = blockers;
  const total = outOfState.length + setup.length + archivedPayers.length;
  if (total === 0) return null;

  return (
    <div
      className="rounded-md border border-[#E8E5E0] bg-[#FAFAF9] p-3"
      data-testid="generation-blockers"
    >
      <p className="text-[13px] font-medium text-foreground">
        {total} {total === 1 ? "gap keeps" : "gaps keep"} expected cases off this list. Each one
        names what&apos;s missing and how to fix it.
      </p>

      {setup.length > 0 ? (
        <Section title={`Payer setup missing (${setup.length})`} defaultOpen>
          {setup.map((entry) => (
            <li
              key={entry.key}
              className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground"
            >
              <span className="font-medium text-foreground">
                {entry.payerName} {entry.state}
              </span>
              <span>
                {entry.block.message} Affects {names(entry.providerNames)}.
              </span>
              <GenerationFixLink block={entry.block} />
            </li>
          ))}
        </Section>
      ) : null}

      {outOfState.length > 0 ? (
        <Section title={`Targets in states the provider doesn't work in (${outOfState.length})`}>
          {outOfState.map((entry) => (
            <li
              key={entry.key}
              className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground"
            >
              <span className="font-medium text-foreground">{entry.providerName}</span>
              <span>
                {entry.groupName} · No clinic or license in {entry.states.join(", ")} ·{" "}
                {names(entry.payerNames)}
              </span>
              <GenerationFixLink block={entry.block} />
            </li>
          ))}
        </Section>
      ) : null}

      {archivedPayers.length > 0 ? (
        <Section title={`Archived payers (${archivedPayers.length})`}>
          {archivedPayers.map((entry) => (
            <li
              key={entry.key}
              className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground"
            >
              <span className="font-medium text-foreground">{entry.payerName}</span>
              <span>
                {entry.groupName} · {entry.states.join(", ")} · {entry.block.message}
              </span>
              <GenerationFixLink block={entry.block} />
            </li>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 space-y-2">{children}</ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
