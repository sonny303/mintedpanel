// Payer & Cases design bundle, screen 3 (Slice C) — everything about one
// payer, and the place to act on it. Supersedes the flat read-only
// PayerDetailContent with the designed TABBED surface (Overview · Enrollments
// · Cases · Templates · Scorecard · Manage) and makes identity EDITABLE in
// place (§2.11) by reusing Slice B's PayerDetailsForm — never a second form.
//
// The payer is resolved from the GLOBAL catalog read (list_global_payers), not
// getPayer: the RLS or-filter can't see an UNASSIGNED global row, and this
// page must render for a payer the org hasn't adopted yet (the Slice B
// near-match "Use this one" hand-off lands here).
//
// Tab bodies mount lazily — each owns its own hooks, so opening Overview never
// fetches the scorecard's fill/status-history caches.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { PayerCasesTab } from "@/components/payer-admin/PayerCasesTab";
import { PayerEnrollmentsTab } from "@/components/payer-admin/PayerEnrollmentsTab";
import { PayerManageTab } from "@/components/payer-admin/PayerManageTab";
import { PayerOverviewTab } from "@/components/payer-admin/PayerOverviewTab";
import { PayerScorecardPanel } from "@/components/payer-admin/PayerScorecardPanel";
import { PayerTemplatesTab } from "@/components/payer-admin/PayerTemplatesTab";
import { useGlobalPayers } from "@/hooks/usePayerCatalog";
import {
  useAddAssignment,
  useOrgPayerAssignments,
  useReactivateAssignment,
} from "@/hooks/useOrgPayerAssignments";
import { assignmentsByPayerId, catalogAction } from "@/lib/payerCatalogActions";
import { PAYER_KIND_LABELS } from "@/lib/payerDirectory";
import {
  PAYER_DETAIL_TABS,
  PAYER_DETAIL_TAB_LABELS,
  type PayerDetailTab,
} from "@/lib/payerDetailView";
import { useIsAdmin } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { OrgPayerAssignment, Payer, PayerCatalogStatus, PayerKind } from "@/types";

const KIND_PILL: Record<PayerKind, StatusColor> = {
  commercial: "brand",
  medicare: "blue",
  medicaid: "teal",
  medicaid_mco: "teal",
  medicare_advantage: "blue",
  tricare: "violet",
};

const STATUS_PILL: Record<PayerCatalogStatus, { label: string; tone: StatusColor }> = {
  active: { label: "Active", tone: "green" },
  merged: { label: "Merged", tone: "amber" },
  retired: { label: "Retired", tone: "neutral" },
};

export interface PayerDetailPageProps {
  payerId: string;
  tab: PayerDetailTab;
  onTabChange: (tab: PayerDetailTab) => void;
  /** `?edit=1` — open Overview with the identity editor already in place. */
  startEditing?: boolean;
}

function BackLink() {
  return (
    <Link
      to="/admin/payer-admin/setup"
      className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
    >
      ← Back to Payer Setup
    </Link>
  );
}

export function PayerDetailPage({
  payerId,
  tab,
  onTabChange,
  startEditing = false,
}: PayerDetailPageProps) {
  const payersQ = useGlobalPayers();
  const assignmentsQ = useOrgPayerAssignments();
  const isAdmin = useIsAdmin();
  const addMut = useAddAssignment();
  const reactivateMut = useReactivateAssignment();

  const payers = useMemo(() => payersQ.data ?? [], [payersQ.data]);
  const payer = useMemo(() => payers.find((p) => p.id === payerId) ?? null, [payers, payerId]);
  const payerById = useMemo(() => new Map(payers.map((p) => [p.id, p])), [payers]);
  const assignment = useMemo(
    () =>
      assignmentsByPayerId((assignmentsQ.data as OrgPayerAssignment[] | undefined) ?? []).get(
        payerId,
      ),
    [assignmentsQ.data, payerId],
  );

  if (payersQ.isError) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-[13px] text-[#B91C1C]">
          Couldn&apos;t load the payer.{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => payersQ.refetch()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (payersQ.data === undefined) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Skeleton className="h-28 w-full rounded-[6px]" />
        <Skeleton className="h-64 w-full rounded-[6px]" />
      </div>
    );
  }

  if (!payer) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-md border border-[#E8E5E0] bg-white p-6 text-center">
          <h1 className="text-[15px] font-semibold text-foreground">Payer not found</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            This payer isn&apos;t in the catalog (or the link is stale).
          </p>
        </div>
      </div>
    );
  }

  const kind = payer.payerKind ?? "commercial";
  const status = STATUS_PILL[payer.status ?? "active"];
  const states = payer.states ?? [];
  const action = catalogAction(payer, assignment, payerById);
  const canManage = isAdmin && assignmentsQ.data !== undefined;
  const mergedInto = payer.mergedIntoId ? (payerById.get(payer.mergedIntoId) ?? null) : null;
  const networkPending = addMut.isPending || reactivateMut.isPending;

  const handleAdd = () => {
    addMut.mutate(payer.id, {
      onSuccess: () => toast.success(`${payer.name} added to your network`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add the payer"),
    });
  };
  const handleReactivateAssignment = () => {
    reactivateMut.mutate(payer.id, {
      onSuccess: () => toast.success(`${payer.name} is back in your network`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't reactivate the payer"),
    });
  };

  return (
    <div className="space-y-4">
      <BackLink />

      <header className="flex flex-wrap items-start gap-5 rounded-[6px] border border-[#E8E5E0] bg-white px-5 py-4">
        <div className="flex min-w-[260px] flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[21px] font-semibold leading-tight tracking-[-.01em] text-foreground">
              {payer.name}
            </h1>
            <StatusPill status={KIND_PILL[kind]} label={PAYER_KIND_LABELS[kind]} />
            <StatusPill status={status.tone} label={status.label} />
            {payer.archivedAt ? <StatusPill status="neutral" label="Archived" /> : null}
            {action.kind === "added" ? <StatusPill status="green" label="In my network" /> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <span>{states.length === 1 ? states[0] : `${states.length} states`}</span>
          </div>
          {payer.status === "merged" ? (
            <p className="text-[13px] text-[#8A6420]">
              Merged into{" "}
              {mergedInto ? (
                <Link
                  to="/admin/payer-admin/setup/$payerId"
                  params={{ payerId: mergedInto.id }}
                  className="font-medium underline underline-offset-2"
                >
                  {mergedInto.name}
                </Link>
              ) : (
                "another payer"
              )}{" "}
              — use that record for new work.
            </p>
          ) : null}
        </div>
        {/* The only network verbs left on this page are ADDING (and the
            follow-on scope hand-off): removal collapsed into Archive on the
            Manage tab (§2.2). */}
        {/* The successor is named ONCE — by the merged-into line above, which
            links it. This says only why there is no Add button. */}
        {action.kind === "unavailable" ? (
          <span className="flex-none self-center text-[12px] text-muted-foreground">
            {action.reason === "merged" ? "Merged" : "Retired"} — can&apos;t be added
          </span>
        ) : null}
        {canManage && action.kind === "added" ? (
          <Button asChild variant="outline" size="sm" className="h-8 flex-none px-3 text-[12px]">
            <Link to="/onboarding/wizard" search={{ section: "payer_network" }}>
              Configure credentialing scope
            </Link>
          </Button>
        ) : null}
        {canManage && action.kind === "add" ? (
          <Button
            size="sm"
            className="h-8 flex-none bg-[#1B4D3E] px-3 text-[12px] text-white hover:bg-[#163F33]"
            disabled={networkPending}
            onClick={handleAdd}
          >
            Add to my network
          </Button>
        ) : null}
        {canManage && action.kind === "reactivate" ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 flex-none px-3 text-[12px]"
            disabled={networkPending}
            onClick={handleReactivateAssignment}
          >
            Add back to my network
          </Button>
        ) : null}
      </header>

      <div
        role="tablist"
        aria-label="Payer sections"
        className="flex flex-wrap items-center gap-0.5 border-b border-[#E8E5E0]"
      >
        {PAYER_DETAIL_TABS.map((key) => {
          const selected = key === tab;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onTabChange(key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium",
                selected
                  ? "border-[#1B4D3E] text-[#1B4D3E]"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {PAYER_DETAIL_TAB_LABELS[key]}
            </button>
          );
        })}
      </div>

      <TabBody tab={tab} payer={payer} onTabChange={onTabChange} startEditing={startEditing} />
    </div>
  );
}

function TabBody({
  tab,
  payer,
  onTabChange,
  startEditing,
}: {
  tab: PayerDetailTab;
  payer: Payer;
  onTabChange: (tab: PayerDetailTab) => void;
  startEditing: boolean;
}) {
  switch (tab) {
    case "overview":
      return (
        <PayerOverviewTab
          payer={payer}
          startEditing={startEditing}
          onViewScorecard={() => onTabChange("scorecard")}
        />
      );
    case "enrollments":
      return <PayerEnrollmentsTab payer={payer} />;
    case "cases":
      return <PayerCasesTab payer={payer} />;
    case "templates":
      return <PayerTemplatesTab payer={payer} />;
    case "scorecard":
      return <PayerScorecardPanel payer={payer} />;
    case "manage":
      return <PayerManageTab payer={payer} />;
  }
}
