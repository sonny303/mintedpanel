// E4.2 F4.2.1/F4.2.2/F4.2.4/F4.2.6 — the payer directory: one row per attached
// payer × state with its derived SOP readiness (Ready / Needs SOP), form
// readiness (mapping coverage for extension_fill SOPs, TE-16), the count of
// currently blocked providers (TE-13), a link to the payer scorecard, the
// per-payer resolution-identifier config (F4.2.1), and the bulk "Generate
// cases" entry into the E2.0 preview scoped to that payer (TE-6). All derived —
// nothing stored.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { usePayerReadiness, type EnrichedReadinessRow } from "@/hooks/usePayerReadiness";
import { usePayers } from "@/hooks/useAdmin";
import { useOrgPayerAssignments } from "@/hooks/useOrgPayerAssignments";
import { useRole } from "@/lib/auth-store";
import { payerSetupEmptyState } from "@/lib/payerCatalogActions";
import { PayerResolutionIdDialog } from "@/components/payer-admin/PayerResolutionIdDialog";
import type { Payer } from "@/types";

function ReadinessCell({ row }: { row: EnrichedReadinessRow }) {
  if (row.ready) {
    return (
      <Badge className="rounded-full border-0 bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)]">
        Ready
      </Badge>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge className="rounded-full border-0 bg-[var(--mp-warn-tint)] text-[var(--mp-warn-ink)]">
        Needs SOP
      </Badge>
      <Link
        to="/admin/templates/new"
        search={{
          payerId: row.matchKey.payerId,
          state: row.matchKey.state,
          groupId: row.matchKey.groupId ?? undefined,
        }}
        className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
      >
        Create SOP
      </Link>
    </span>
  );
}

function FormCell({ row }: { row: EnrichedReadinessRow }) {
  const cov = row.formCoverage;
  if (!cov) return <span className="text-[12px] text-muted-foreground">—</span>;
  if (!cov.available) {
    return <span className="text-[12px] text-muted-foreground">No maps</span>;
  }
  const pct = Math.round((cov.ratio ?? 0) * 100);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[12px] tabular-nums">{pct}% mapped</span>
    </span>
  );
}

export function PayerDirectory() {
  const readiness = usePayerReadiness();
  const payersQ = usePayers();
  const assignmentsQ = useOrgPayerAssignments();
  const role = useRole();
  const canViewScorecard = role === "admin" || role === "billing";
  const [configuring, setConfiguring] = useState<Payer | null>(null);

  if (readiness.isError) {
    return <EmptyState message="Couldn't load payer readiness." />;
  }
  if (!readiness.rows || assignmentsQ.data === undefined) {
    return <Skeleton className="h-40 w-full" />;
  }
  // Empty readiness ⟺ no ACTIVE payer_network_targets. Distinguish the two
  // causes so the empty state points at the right next step (F item 4b):
  // no payers added yet vs. payers added but no credentialing scope configured.
  if (readiness.rows.length === 0) {
    if (payerSetupEmptyState(assignmentsQ.data) === "no_payers") {
      return (
        <EmptyState
          message="No payers have been added to this organization yet."
          description="Browse the payer catalog and add the payers this organization works with — they'll appear here once their credentialing scope is configured."
          action={
            <Button asChild size="sm">
              <Link to="/payer-directory">Browse payer catalog</Link>
            </Button>
          }
        />
      );
    }
    return (
      <EmptyState
        message="Payers are added, but no credentialing scope is configured yet."
        description="Configure credentialing scope (group × state targets) in the Payer Network section to see per-payer SOP readiness here."
        action={
          <Button asChild size="sm">
            <Link to="/onboarding/wizard" search={{ section: "payer_network" }}>
              Configure credentialing scope
            </Link>
          </Button>
        }
      />
    );
  }

  const payerById = new Map((payersQ.data ?? []).map((p) => [p.id, p]));

  return (
    <div className="rounded-md border border-[#E8E5E0] overflow-hidden bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
              {["Payer", "State", "Groups", "Readiness", "Form", "Blocked", ""].map((h, i) => (
                <th
                  key={i}
                  className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {readiness.rows.map((row) => {
              const payer = payerById.get(row.payerId) ?? null;
              return (
                <tr
                  key={`${row.payerId}|${row.state}`}
                  className="border-b border-[#E8E5E0] last:border-0"
                >
                  <td className="px-3 h-10 align-middle font-medium">{row.payerName}</td>
                  <td className="px-3 h-10 align-middle">{row.state}</td>
                  <td className="px-3 h-10 align-middle text-muted-foreground">
                    {row.coveredCount}/{row.totalCount}
                  </td>
                  <td className="px-3 h-10 align-middle">
                    <ReadinessCell row={row} />
                  </td>
                  <td className="px-3 h-10 align-middle">
                    <FormCell row={row} />
                    {row.formCoverage ? (
                      <span className="ml-1 text-[12px]">
                        (
                        <Link
                          to="/admin/payer-admin/forms/$payerId"
                          params={{ payerId: row.payerId }}
                          className="text-[#1B4D3E] underline underline-offset-2"
                        >
                          train
                        </Link>
                        )
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 h-10 align-middle">
                    {row.blockedCount > 0 ? (
                      <Link
                        to="/generation"
                        search={{ payerId: row.payerId }}
                        className="inline-flex items-center gap-1 text-[#B45309] underline underline-offset-2"
                        title="View blocked providers with their missing attributes"
                      >
                        {row.blockedCount} blocked
                      </Link>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">0</span>
                    )}
                  </td>
                  <td
                    className="px-3 h-10 align-middle text-right whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inline-flex items-center gap-1.5">
                      {canViewScorecard && payer ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] px-2"
                          asChild
                        >
                          <Link to="/admin/payers/$id/scorecard" params={{ id: row.payerId }}>
                            Scorecard
                          </Link>
                        </Button>
                      ) : null}
                      <Button variant="outline" size="sm" className="h-7 text-[11px] px-2" asChild>
                        <Link to="/generation" search={{ payerId: row.payerId }}>
                          Generate cases
                        </Link>
                      </Button>
                      {payer && role === "admin" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] px-2"
                          onClick={() => setConfiguring(payer)}
                        >
                          Configure ID
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {configuring ? (
        <PayerResolutionIdDialog payer={configuring} onClose={() => setConfiguring(null)} />
      ) : null}
    </div>
  );
}
