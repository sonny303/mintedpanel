// E4.2 unified payer setup (TE-19/TE-20) — the Setup tab: one row per ACTIVE
// organization payer (from catalog subscriptions, never from targets, so a
// zero-target payer is visible), with separate dimensions — scope, SOP
// coverage, form coverage, profile blockers, generation — and ONE dominant
// next action linking straight to the surface that fixes it. Supersedes the
// payer × state readiness table (that detail now lives in each row's
// expansion). Preserves the e4-2c governance affordances the old
// /admin/payers route carried: the starter toggle (org_payer_assignments
// fact, admin-only), the scorecard link, and the read-only posture over
// Minted-curated identity facts.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { usePayerSetup } from "@/hooks/usePayerSetup";
import { useOrgPayerSetting } from "@/hooks/useOrgPayerSettings";
import { useSetStarter } from "@/hooks/useOrgPayerAssignments";
import { useRole } from "@/lib/auth-store";
import type { NextAction, PayerSetupRow } from "@/lib/payerSetup";
import type { SopResolutionTier } from "@/lib/pickTemplate";
import { PayerResolutionIdDialog } from "@/components/payer-admin/PayerResolutionIdDialog";
import type { OrgPayerAssignment, Payer } from "@/types";

// F4.2.1 template-tier visibility, matching the templates list's wording.
const SOP_TIER_LABEL: Record<SopResolutionTier, string> = {
  organization: "Organization override",
  global_payer: "Global payer SOP",
  generic_fallback: "Generic fallback",
};

function ScopeCell({ row }: { row: PayerSetupRow }) {
  if (row.scope.activeTargets === 0) {
    return <span className="text-[12px] text-muted-foreground">Not configured</span>;
  }
  return (
    <span className="text-[13px] tabular-nums">
      {row.scope.activeTargets} target{row.scope.activeTargets === 1 ? "" : "s"}
      <span className="text-muted-foreground"> · {row.scope.states.join(", ")}</span>
    </span>
  );
}

function SopCell({ row }: { row: PayerSetupRow }) {
  const sop = row.sop;
  if (sop.kind === "no_scope") return <span className="text-[12px] text-muted-foreground">—</span>;
  if (sop.kind === "needs_sop") {
    return (
      <span className="inline-flex items-center gap-2">
        <Badge className="rounded-full border-0 bg-[var(--mp-warn-tint)] text-[var(--mp-warn-ink)]">
          Needs payer SOP
        </Badge>
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {sop.covered}/{sop.total} covered
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Badge className="rounded-full border-0 bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)]">
        Covered
      </Badge>
      <span className="text-[12px] tabular-nums text-muted-foreground">
        {sop.covered}/{sop.total}
        {sop.tier ? ` · ${SOP_TIER_LABEL[sop.tier]}` : ""}
      </span>
    </span>
  );
}

function FormCell({ row }: { row: PayerSetupRow }) {
  const form = row.form;
  switch (form.kind) {
    case "not_applicable":
      return (
        <span className="text-[12px] text-muted-foreground" title="No extension-fill SOP tasks">
          —
        </span>
      );
    case "unregistered":
      return (
        <Badge className="rounded-full border-0 bg-[var(--mp-warn-tint)] text-[var(--mp-warn-ink)]">
          Unregistered
        </Badge>
      );
    case "capture":
      return <span className="text-[12px] text-muted-foreground">No fields captured</span>;
    case "training":
      return (
        <span className="inline-flex items-center gap-1.5 text-[12px] tabular-nums">
          {form.total > 0 ? Math.round((form.approved / form.total) * 100) : 0}% mapped
          {form.unlinked > 0 ? (
            <StatusPill status="amber" label={`${form.unlinked} no value`} />
          ) : null}
        </span>
      );
    case "dry_run_pending":
      return <span className="text-[12px] tabular-nums">100% mapped · no dry run</span>;
    case "tested":
      return (
        <span
          className={`text-[12px] tabular-nums ${form.gaps > 0 ? "text-[#B45309]" : "text-[#166534]"}`}
        >
          Dry run: {form.filled} filled · {form.gaps} gap{form.gaps === 1 ? "" : "s"}
        </span>
      );
  }
}

function GenerationCell({ row }: { row: PayerSetupRow }) {
  const g = row.generation;
  const pill =
    g.status === "ready" ? (
      <Badge className="rounded-full border-0 bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)]">
        Ready
      </Badge>
    ) : g.status === "warning" ? (
      <Badge className="rounded-full border-0 bg-[var(--mp-warn-tint)] text-[var(--mp-warn-ink)]">
        Warning
      </Badge>
    ) : (
      <Badge className="rounded-full border-0 bg-[var(--mp-danger-tint)] text-[var(--mp-danger-ink)]">
        Blocked
      </Badge>
    );
  return (
    <span className="inline-flex flex-col gap-0.5">
      {pill}
      {g.reasons.length > 0 ? (
        <span className="text-[11px] leading-tight text-muted-foreground">{g.reasons[0]}</span>
      ) : null}
    </span>
  );
}

// The ONE dominant next action per row — always a direct link to the surface
// that fixes the blocker (configure_resolution_id opens the e4-2c dialog).
function NextActionCell({
  row,
  onConfigureId,
}: {
  row: PayerSetupRow;
  onConfigureId: (payer: Payer) => void;
}) {
  const action: NextAction = row.nextAction;
  const btn = "h-7 px-2 text-[11px]";
  switch (action.kind) {
    case "configure_scope":
      return (
        <Button variant="outline" size="sm" className={btn} asChild>
          <Link to="/onboarding/wizard" search={{ section: "payer_network" }}>
            Configure scope
          </Link>
        </Button>
      );
    case "create_sop":
      return (
        <Button variant="outline" size="sm" className={btn} asChild>
          <Link
            to="/admin/templates/new"
            search={{
              payerId: action.matchKey.payerId,
              state: action.matchKey.state,
              groupId: action.matchKey.groupId ?? undefined,
            }}
          >
            Create payer SOP
          </Link>
        </Button>
      );
    case "resolve_blockers":
      return (
        <Button variant="outline" size="sm" className={btn} asChild>
          <Link to="/generation" search={{ payerId: row.payer.id }}>
            Resolve blockers ({action.count})
          </Link>
        </Button>
      );
    case "register_portal":
      return (
        <Button variant="outline" size="sm" className={btn} asChild>
          <Link to="/admin/portals" search={{ payerId: row.payer.id }}>
            Register portal
          </Link>
        </Button>
      );
    case "train_mappings":
      if (action.mode === "capture") {
        return (
          <Button variant="outline" size="sm" className={btn} asChild>
            <Link to="/admin/payer-admin/forms/$payerId" params={{ payerId: row.payer.id }}>
              Capture form fields
            </Link>
          </Button>
        );
      }
      return (
        <Button variant="outline" size="sm" className={btn} asChild>
          <Link to="/portals/$portalKey/train" params={{ portalKey: action.portalKey }}>
            Train form fields
          </Link>
        </Button>
      );
    case "run_dry_test":
      return (
        <Button variant="outline" size="sm" className={btn} asChild>
          <Link to="/admin/payer-admin/forms/$payerId" params={{ payerId: row.payer.id }}>
            Run form dry test
          </Link>
        </Button>
      );
    case "configure_resolution_id":
      return (
        <Button
          variant="outline"
          size="sm"
          className={btn}
          onClick={() => onConfigureId(row.payer)}
        >
          Configure payer ID
        </Button>
      );
    case "review_generation":
      return (
        <Button variant="outline" size="sm" className={btn} asChild>
          <Link to="/generation" search={{ payerId: row.payer.id }}>
            Review generation preview
          </Link>
        </Button>
      );
  }
}

function StarterToggle({
  assignment,
  payerName,
  canEdit,
}: {
  assignment: OrgPayerAssignment | null;
  payerName: string;
  canEdit: boolean;
}) {
  const setStarter = useSetStarter();
  // Every included row carries an active assignment by construction; the null
  // guard is defensive. Non-admins never see a control they can't complete.
  if (!assignment) return <span className="text-[12px] text-muted-foreground">—</span>;
  if (!canEdit) {
    return (
      <span className="text-[12px] text-muted-foreground">
        {assignment.starter ? "Starter" : "—"}
      </span>
    );
  }
  return (
    <Switch
      checked={assignment.starter}
      disabled={setStarter.isPending}
      aria-label={`Toggle starter pack for ${payerName}`}
      onCheckedChange={(v) =>
        setStarter.mutate(
          { payerId: assignment.payerId, starter: v },
          {
            onSuccess: () =>
              toast.success(v ? "Added to starter pack" : "Removed from starter pack"),
            onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
          },
        )
      }
    />
  );
}

// Per-state readiness detail (the former payer × state matrix, scoped to one
// payer) + the org-owned governance flags.
function SetupDetailRow({ row, canEdit }: { row: PayerSetupRow; canEdit: boolean }) {
  return (
    <tr className="border-b border-[#E8E5E0] bg-[#FAFAF9] last:border-0">
      <td colSpan={7} className="px-4 py-3">
        <div className="space-y-3">
          {row.stateRows.length > 0 ? (
            <table className="w-full max-w-[560px] text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="h-8 pr-3 font-medium">State</th>
                  <th className="h-8 pr-3 font-medium">Groups covered</th>
                  <th className="h-8 pr-3 font-medium">SOP</th>
                  <th className="h-8 pr-3 font-medium">Blocked</th>
                </tr>
              </thead>
              <tbody>
                {row.stateRows.map((s) => (
                  <tr key={s.state}>
                    <td className="h-8 pr-3">{s.state}</td>
                    <td className="h-8 pr-3 tabular-nums">
                      {s.coveredCount}/{s.totalCount}
                    </td>
                    <td className="h-8 pr-3">
                      {s.ready ? (
                        <span className="text-[#166534]">
                          {s.sopTier ? SOP_TIER_LABEL[s.sopTier] : "Payer SOP resolves"}
                        </span>
                      ) : (
                        <Link
                          to="/admin/templates/new"
                          search={{
                            payerId: s.matchKey.payerId,
                            state: s.matchKey.state,
                            groupId: s.matchKey.groupId ?? undefined,
                          }}
                          className="font-medium text-[#1B4D3E] underline underline-offset-2"
                        >
                          Create SOP for {s.state}
                        </Link>
                      )}
                    </td>
                    <td className="h-8 pr-3">
                      {s.blockedCount > 0 ? (
                        <Link
                          to="/generation"
                          search={{ payerId: row.payer.id }}
                          className="text-[#B45309] underline underline-offset-2"
                        >
                          {s.blockedCount} blocked
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              No credentialing targets yet — the per-state readiness detail appears once scope is
              configured.
            </p>
          )}
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="text-muted-foreground">Starter pack:</span>
            <StarterToggle
              assignment={row.assignment}
              payerName={row.payer.name}
              canEdit={canEdit}
            />
          </div>
        </div>
      </td>
    </tr>
  );
}

export function PayerSetupList() {
  const setup = usePayerSetup();
  const role = useRole();
  const canEdit = role === "admin";
  const canViewScorecard = role === "admin" || role === "billing";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [configuring, setConfiguring] = useState<Payer | null>(null);
  // The org's setting row for the payer being configured (org_payer_settings —
  // the dialog writes the org grain, never the Minted-managed payers row).
  const configuringSetting = useOrgPayerSetting(configuring?.id);

  if (setup.isError) {
    return <EmptyState message="Couldn't load the payer setup list." />;
  }
  if (setup.rows === undefined) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (setup.rows.length === 0) {
    return (
      <EmptyState
        message="No payers have been added to this organization yet."
        description="Browse the payer catalog and add the payers this organization works with — each appears here with its setup checklist the moment it's added."
        action={
          <Button asChild size="sm">
            <Link to="/admin/payer-admin" search={{ tab: "catalog" }}>
              Open the payer catalog
            </Link>
          </Button>
        }
      />
    );
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const summary = setup.summary;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12.5px] text-muted-foreground">
          {summary
            ? `${summary.generationReady} of ${summary.total} payer${summary.total === 1 ? "" : "s"} generation-ready.`
            : null}{" "}
          Payer identities and catalog facts are managed by Minted — add payers from the Catalog
          tab.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-[#E8E5E0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#E8E5E0] bg-[#FAFAF9]">
                {[
                  "Payer",
                  "Credentialing scope",
                  "SOP coverage",
                  "Form coverage",
                  "Blockers",
                  "Generation",
                  "Next action",
                ].map((h, i) => (
                  <th
                    key={i}
                    className="h-10 whitespace-nowrap px-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {setup.rows.map((row) => (
                <SetupRow
                  key={row.payer.id}
                  row={row}
                  expanded={expanded.has(row.payer.id)}
                  onToggle={() => toggle(row.payer.id)}
                  canEdit={canEdit}
                  canViewScorecard={canViewScorecard}
                  onConfigureId={setConfiguring}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {configuring ? (
        <PayerResolutionIdDialog
          payer={configuring}
          setting={configuringSetting}
          onClose={() => setConfiguring(null)}
        />
      ) : null}
    </div>
  );
}

function SetupRow({
  row,
  expanded,
  onToggle,
  canEdit,
  canViewScorecard,
  onConfigureId,
}: {
  row: PayerSetupRow;
  expanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
  canViewScorecard: boolean;
  onConfigureId: (payer: Payer) => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <>
      <tr className="border-b border-[#E8E5E0] last:border-0">
        <td className="h-10 px-3 align-middle">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`Show setup detail for ${row.payer.name}`}
              className="rounded-[var(--mp-radius-control)] p-0.5 text-muted-foreground hover:text-foreground"
              onClick={onToggle}
            >
              <Chevron className="h-4 w-4" />
            </button>
            <span className="font-medium">{row.payer.name}</span>
          </div>
        </td>
        <td className="h-10 px-3 align-middle whitespace-nowrap">
          <ScopeCell row={row} />
        </td>
        <td className="h-10 px-3 align-middle whitespace-nowrap">
          <SopCell row={row} />
        </td>
        <td className="h-10 px-3 align-middle whitespace-nowrap">
          <FormCell row={row} />
        </td>
        <td className="h-10 px-3 align-middle whitespace-nowrap">
          {row.blockedCount > 0 ? (
            <Link
              to="/generation"
              search={{ payerId: row.payer.id }}
              className="text-[#B45309] underline underline-offset-2"
              title="View blocked providers with their missing attributes"
            >
              {row.blockedCount} blocked
            </Link>
          ) : (
            <span className="text-[12px] text-muted-foreground">0</span>
          )}
        </td>
        <td className="h-10 px-3 align-middle">
          <GenerationCell row={row} />
        </td>
        <td className="h-10 px-3 align-middle text-right whitespace-nowrap">
          <div className="inline-flex items-center gap-1.5">
            <NextActionCell row={row} onConfigureId={onConfigureId} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-[#99A49B]"
                  aria-label={`More actions for ${row.payer.name}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canViewScorecard ? (
                  <DropdownMenuItem asChild>
                    <Link to="/admin/payers/$id/scorecard" params={{ id: row.payer.id }}>
                      Scorecard
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem asChild>
                  <Link to="/generation" search={{ payerId: row.payer.id }}>
                    Generate cases
                  </Link>
                </DropdownMenuItem>
                {row.form.kind !== "not_applicable" ? (
                  <DropdownMenuItem asChild>
                    <Link to="/admin/payer-admin/forms/$payerId" params={{ payerId: row.payer.id }}>
                      Form onboarding &amp; test runner
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {canEdit ? (
                  <DropdownMenuItem onSelect={() => onConfigureId(row.payer)}>
                    Configure ID
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </td>
      </tr>
      {expanded ? <SetupDetailRow row={row} canEdit={canEdit} /> : null}
    </>
  );
}
