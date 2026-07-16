// Admin → Payers list. E4.2 payer governance: canonical payer identities are
// SELECTED from the Minted catalog (Payer Directory → Add to organization),
// never typed — there is no free-text "Add payer" and no org-side edit of
// identity or Minted-curated facts (name, avg decision days, catalog fields).
// Global rows are visibly Minted-managed; legacy org-scoped rows are read-only
// pending the catalog cutover (docs/data-model/legacy-payer-cutover.md). The
// org-owned config that remains here is the starter-pack toggle (an
// org_payer_assignments fact, not a payers fact).
import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePayers } from "@/hooks/useAdmin";
import { useOrgPayerAssignments, useSetStarter } from "@/hooks/useOrgPayerAssignments";
import { useIsAdmin } from "@/lib/permissions";
import { useRole } from "@/lib/auth-store";
import type { OrgPayerAssignment, Payer } from "@/types";

export const Route = createFileRoute("/admin/payers")({
  component: AdminPayersPage,
});

function YesNoPill({ value }: { value: boolean }) {
  return value ? (
    <StatusPill status="green" label="Yes" />
  ) : (
    <StatusPill status="neutral" label="No" />
  );
}

// Where the row's identity is owned: a global catalog row is Minted-managed
// (read-only facts); an org-scoped row is a pre-catalog legacy identity that
// stays read-only until the supervised cutover re-keys its references.
function SourceCell({ payer }: { payer: Payer }) {
  if (payer.orgId === null) {
    return <StatusPill status="brand" label="Minted catalog" />;
  }
  return <StatusPill status="neutral" label="Legacy — catalog migration required" />;
}

function AdminPayersPage() {
  const canEdit = useIsAdmin();
  const role = useRole();
  const canViewScorecard = role === "admin" || role === "billing";
  const payersQ = usePayers();
  const assignmentsQ = useOrgPayerAssignments();

  // Only assigned global-catalog payers carry a starter toggle; org-scoped
  // legacy payers have no assignment row.
  const assignmentByPayer = useMemo(() => {
    const m = new Map<string, OrgPayerAssignment>();
    for (const a of assignmentsQ.data ?? []) m.set(a.payerId, a);
    return m;
  }, [assignmentsQ.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payers"
        description="The payers available to this organization. Identities and catalog facts are managed by Minted."
        actions={
          <Button asChild className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9">
            <Link to="/payer-directory">Browse payer catalog</Link>
          </Button>
        }
      />

      <div className="border border-[#E8E5E0] rounded-md bg-[#FAFAF9] px-4 py-3 text-[13px] text-foreground">
        Payers are added from the Minted payer catalog — identities are never typed by hand. Legacy
        payers created before the catalog are read-only until their cases and contracts are migrated
        to a canonical identity.
      </div>

      <div className="border border-[#E8E5E0] rounded-md overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
                {["Payer", "Source", "Active", "Avg decision", "Starter", ""].map((h, i) => (
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
              {payersQ.isLoading ? (
                <TableSkeletonRows rows={8} cols={6} />
              ) : payersQ.isError ? (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center">
                    <EmptyState
                      message="Failed to load payers"
                      action={
                        <Button variant="outline" size="sm" onClick={() => payersQ.refetch()}>
                          Retry
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ) : (payersQ.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-12">
                    <EmptyState
                      message="No payers yet"
                      action={
                        <Button asChild variant="outline" size="sm">
                          <Link to="/payer-directory">Browse payer catalog</Link>
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                (payersQ.data ?? []).map((p) => (
                  <tr key={p.id} className="border-b border-[#E8E5E0] last:border-b-0">
                    <td className="px-3 h-10 align-middle font-medium">{p.name}</td>
                    <td className="px-3 h-10 align-middle">
                      <SourceCell payer={p} />
                    </td>
                    <td className="px-3 h-10 align-middle">
                      <YesNoPill value={p.isActive} />
                    </td>
                    <td className="px-3 h-10 align-middle text-muted-foreground">
                      {p.avgDecisionDays != null ? `${p.avgDecisionDays} d` : "—"}
                    </td>
                    <td className="px-3 h-10 align-middle">
                      <StarterToggle
                        assignment={assignmentByPayer.get(p.id) ?? null}
                        payerName={p.name}
                        canEdit={canEdit}
                      />
                    </td>
                    <td className="px-3 h-10 align-middle text-right">
                      {canViewScorecard && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] px-2"
                          asChild
                        >
                          <Link to="/admin/payers/$id/scorecard" params={{ id: p.id }}>
                            Scorecard
                          </Link>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
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
  // Org-scoped payers (no assignment row) are not part of the global starter
  // pack, so no toggle is shown. Non-admins get no control at all — a control
  // never renders unless the caller can actually complete the action.
  if (!assignment) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (!canEdit) {
    return <span className="text-muted-foreground">{assignment.starter ? "Starter" : "—"}</span>;
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
