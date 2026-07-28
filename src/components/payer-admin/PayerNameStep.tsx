// Payer & Cases design bundle, screen 2 step 1 (Slice B) — name + near match.
// The name is asked FIRST and existing payers surface before any other field:
// this is the guardrail against duplicate payer records ("setting up a
// duplicate splits templates and enrollment IDs across two records").
//
// The pool is the GLOBAL catalog read (list_global_payers), not the org's
// visible payers — create_payer's duplicate guard runs against every
// non-retired global row, so matching on the org-scoped list would miss a
// collision the RPC will reject. Matching itself is the shared pure
// findPayerNearMatches (E6.7), which normalizes exactly like the SQL guard.
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { PAYER_KIND_LABELS, formatStates } from "@/lib/payerDirectory";
import type { PayerNearMatch } from "@/lib/payerNearMatch";
import type { PayerCatalogStatus } from "@/types";

const STATUS_PILL: Record<PayerCatalogStatus, { label: string; tone: StatusColor }> = {
  active: { label: "Active", tone: "green" },
  merged: { label: "Merged", tone: "neutral" },
  retired: { label: "Retired", tone: "neutral" },
};

function matchMeta(match: PayerNearMatch): string {
  const payer = match.payer;
  const kind = PAYER_KIND_LABELS[payer.payerKind ?? "commercial"];
  const states = formatStates(payer.states);
  const merged = match.successor ? ` · merged into ${match.successor.name}` : "";
  return `${kind} · ${states}${merged}`;
}

interface PayerNameStepProps {
  name: string;
  onNameChange: (next: string) => void;
  matches: PayerNearMatch[];
  loadingMatches: boolean;
  /** Blocks Continue when the name is empty. */
  error?: string | null;
  onContinue: () => void;
}

export function PayerNameStep({
  name,
  onNameChange,
  matches,
  loadingMatches,
  error,
  onContinue,
}: PayerNameStepProps) {
  const hasMatches = matches.length > 0;
  return (
    <section className="rounded-[6px] border border-[#E8E5E0] bg-white">
      <header className="border-b border-[#E8E5E0] px-5 py-4">
        <h1 className="text-[19px] font-semibold tracking-[-.01em] text-foreground">Add a payer</h1>
        <p className="text-[13px] text-muted-foreground">
          Start with the payer&apos;s name — we&apos;ll check whether it already exists before you
          fill anything else in.
        </p>
      </header>
      <div className="p-5">
        <div className="mb-4 space-y-1.5">
          <Label
            htmlFor="payer-name-draft"
            className="text-[12px] font-semibold uppercase tracking-[.05em] text-[#6B7280]"
          >
            Payer name
          </Label>
          <Input
            id="payer-name-draft"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. Blue Cross Blue Shield of Arizona"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "payer-name-draft-error" : undefined}
            className="h-9"
          />
          {error ? (
            <p id="payer-name-draft-error" className="text-[12.5px] text-[#B91C1C]">
              {error}
            </p>
          ) : null}
        </div>

        {loadingMatches ? (
          <Skeleton className="mb-4 h-16 rounded-[6px]" />
        ) : hasMatches ? (
          <div className="mb-4 overflow-hidden rounded-[6px] border border-[#E8D9B5] bg-[#FCFBF7]">
            <div className="border-b border-[#EFE7D3] px-3.5 py-2.5">
              <p className="text-[13px] font-semibold text-[#8A6420]">
                {matches.length === 1
                  ? "1 existing payer looks like a match"
                  : `${matches.length} existing payers look like a match`}
              </p>
              <p className="mt-0.5 text-[12.5px] text-[#8A6420]">
                Setting up a duplicate splits templates and enrollment IDs across two records.
              </p>
            </div>
            {matches.map((match) => {
              // A merged row points at its successor — that is the payer to
              // use; merge itself lives on Payer Detail → Manage.
              const target = match.successor ?? match.payer;
              const status = STATUS_PILL[match.payer.status ?? "active"];
              return (
                <div
                  key={match.payer.id}
                  className="flex flex-wrap items-center gap-3 border-t border-[#F0EEEA] bg-white px-3.5 py-3"
                >
                  <div className="min-w-[180px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-foreground">
                        {match.payer.name}
                      </span>
                      <StatusPill status={status.tone} label={status.label} />
                      {match.matchKind === "exact_alias" ? (
                        <span className="text-[12px] text-muted-foreground">matches an alias</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">{matchMeta(match)}</p>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    className="h-8 flex-none bg-[#1B4D3E] px-3 text-white hover:bg-[#163F33]"
                  >
                    <Link to="/admin/payer-admin/setup/$payerId" params={{ payerId: target.id }}>
                      Use this one
                    </Link>
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-[#F0EEEA] pt-4">
          <Button asChild variant="outline">
            <Link to="/admin/payer-admin/setup">Cancel</Link>
          </Button>
          <Button
            type="button"
            onClick={onContinue}
            // Disabled while the catalog read is in flight — a fast click must
            // never slip past the near-match check before it has data.
            disabled={loadingMatches}
            variant={hasMatches ? "outline" : "default"}
            className={hasMatches ? undefined : "bg-[#1B4D3E] text-white hover:bg-[#163F33]"}
          >
            {hasMatches ? "None of these — set up new" : "Continue"}
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </section>
  );
}
