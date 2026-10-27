// Brief 2026-10-27 — "Why isn't it here?": pick a provider, payer and state;
// the lookup walks the SAME chain the page list uses (generationBlockers.ts)
// for each of the provider's current groups and names the first missing link
// with its fix, or what the preview did with the row. Read-only.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GenerationFixLink } from "@/components/generation/GenerationBlockersPanel";
import { usePayers } from "@/hooks/useAdmin";
import { useProviders } from "@/hooks/useProviders";
import type { GenerationPreviewData } from "@/hooks/useGenerationPreview";
import type { BufferFactInput } from "@/lib/generationBuffer";
import {
  currentGroupsForProvider,
  generationPairVerdict,
  type GenerationPairVerdict,
} from "@/lib/generationBlockers";
import { previewRowKey } from "@/lib/generationPreview";
import { US_STATES } from "@/lib/usStates";

const NONE = "__none__";

interface GenerationPairLookupProps {
  preview: GenerationPreviewData;
  facts: readonly BufferFactInput[];
}

export function GenerationPairLookup({ preview, facts }: GenerationPairLookupProps) {
  const providersQ = useProviders();
  const payersQ = usePayers();
  const [providerId, setProviderId] = useState(NONE);
  const [payerId, setPayerId] = useState(NONE);
  const [state, setState] = useState(NONE);

  const providers = useMemo(
    () =>
      (providersQ.data ?? [])
        .map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim() }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [providersQ.data],
  );
  const payers = useMemo(
    () => (payersQ.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [payersQ.data],
  );

  const results = useMemo(() => {
    const index = preview.blockerIndex;
    if (!index || providerId === NONE || payerId === NONE || state === NONE) return null;
    const rowsByKey = new Map((preview.rows ?? []).map((r) => [previewRowKey(r), r]));
    const liveFactKeys = new Set(
      facts
        .filter((f) => f.expiredAt === null)
        .map((f) => `${f.providerId}|${f.groupId}|${f.payerId}|${f.state}`),
    );
    const unmatched = new Set((preview.unmatched ?? []).map(previewRowKey));
    const ambiguous = new Set((preview.ambiguous ?? []).map(previewRowKey));
    const unmetByKey = new Map(
      (preview.gated ?? []).map((g) => [previewRowKey(g.row), g.unmet.map((u) => u.label)]),
    );
    const groups = currentGroupsForProvider(index, providerId);
    return groups.map((group) => {
      const key = { providerId, groupId: group.id, payerId, state };
      const rowKey = previewRowKey(key);
      return {
        group,
        verdict: generationPairVerdict(index, key, {
          row: rowsByKey.get(rowKey),
          enrolled: liveFactKeys.has(rowKey),
          noTemplate: unmatched.has(rowKey),
          tiedTemplates: ambiguous.has(rowKey),
          missingAttributes: unmetByKey.get(rowKey) ?? [],
        }),
      };
    });
  }, [preview, facts, providerId, payerId, state]);

  return (
    <Collapsible className="rounded-md border border-[#E8E5E0] p-3">
      <CollapsibleTrigger className="flex items-center gap-1 text-[13px] font-medium text-foreground">
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        Why isn&apos;t a pair here?
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Pick a provider, payer and state. You&apos;ll see what generating does for each of the
          provider&apos;s groups, or the one thing that blocks it.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="lookup-provider">Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger id="lookup-provider" className="h-9">
                <SelectValue placeholder="Choose a provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Choose a provider</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lookup-payer">Payer</Label>
            <Select value={payerId} onValueChange={setPayerId}>
              <SelectTrigger id="lookup-payer" className="h-9">
                <SelectValue placeholder="Choose a payer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Choose a payer</SelectItem>
                {payers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lookup-state">State</Label>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger id="lookup-state" className="h-9">
                <SelectValue placeholder="Choose a state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Choose a state</SelectItem>
                {US_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {results === null ? null : results.length === 0 ? (
          <div
            className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground"
            data-testid="pair-lookup-result"
          >
            <span>This provider isn&apos;t a current member of any group.</span>
            <Link
              to="/providers/$id"
              params={{ id: providerId }}
              className="ml-auto text-[12px] text-primary underline-offset-2 hover:underline"
            >
              Open provider
            </Link>
          </div>
        ) : (
          <ul className="mt-3 space-y-2" data-testid="pair-lookup-result">
            {results.map(({ group, verdict }) => (
              <li
                key={group.id}
                className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground"
              >
                <span className="font-medium text-foreground">{group.name}</span>
                <VerdictLine verdict={verdict} />
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function VerdictLine({ verdict }: { verdict: GenerationPairVerdict }) {
  switch (verdict.kind) {
    case "blocked":
      return (
        <>
          <span>{verdict.block.message}</span>
          <GenerationFixLink block={verdict.block} />
        </>
      );
    case "create":
      return <span>Will create when you confirm (it&apos;s on the list above).</span>;
    case "existing":
      return (
        <>
          <span>A case {verdict.label}.</span>
          <Link
            to="/cases/$id"
            params={{ id: verdict.caseId }}
            className="ml-auto text-[12px] text-primary underline-offset-2 hover:underline"
          >
            Open case
          </Link>
        </>
      );
    case "excluded":
      return (
        <span>
          Excluded: {verdict.reasonLabel}
          {verdict.note ? ` (${verdict.note})` : ""}. Undo it on the list above.
        </span>
      );
    case "enrolled":
      return <span>Already enrolled under this group, so no case is needed.</span>;
    case "no_template":
      return (
        <span>No Enrollment SOP matches this payer, state and group (see the list above).</span>
      );
    case "tied_templates":
      return <span>Several SOPs tie for this case. Choose one on the list above.</span>;
    case "missing_attributes":
      return <span>Blocked by missing profile fields: {verdict.labels.join(", ")}.</span>;
    case "not_in_preview":
      return <span>Not in this preview yet. Reload the page to recompute.</span>;
  }
}
