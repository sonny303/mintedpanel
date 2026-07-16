// Admin → Payers list and edit. Name, active flag, and avg decision days are
// the org-editable payer settings; catalog identity/curation fields are owned
// by the sync pipeline, not this screen.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePayers, useCreatePayer, useUpdatePayer } from "@/hooks/useAdmin";
import { useOrgPayerAssignments, useSetStarter } from "@/hooks/useOrgPayerAssignments";
import { useIsAdmin } from "@/lib/permissions";
import { useRole } from "@/lib/auth-store";
import type { OrgPayerAssignment, Payer } from "@/types";
import type { PayerInput } from "@/services/payers";

export const Route = createFileRoute("/admin/payers")({
  component: AdminPayersPage,
});

const EMPTY: PayerInput = {
  name: "",
  isActive: true,
  avgDecisionDays: null,
};

function YesNoPill({ value }: { value: boolean }) {
  return value ? (
    <StatusPill status="green" label="Yes" />
  ) : (
    <StatusPill status="neutral" label="No" />
  );
}

function AdminPayersPage() {
  const canEdit = useIsAdmin();
  const role = useRole();
  const canViewScorecard = role === "admin" || role === "billing";
  const payersQ = usePayers();
  const assignmentsQ = useOrgPayerAssignments();
  const [editing, setEditing] = useState<{ payer: Payer | null } | null>(null);

  // Only assigned global-catalog payers carry a starter toggle; org-scoped
  // payers have no assignment row. Zero assignments exist today, so no toggle
  // renders until a global payer is assigned to this org.
  const assignmentByPayer = useMemo(() => {
    const m = new Map<string, OrgPayerAssignment>();
    for (const a of assignmentsQ.data ?? []) m.set(a.payerId, a);
    return m;
  }, [assignmentsQ.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payers"
        description="Configure the payers available for case creation."
        actions={
          canEdit ? (
            <Button
              onClick={() => setEditing({ payer: null })}
              className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
            >
              <Plus className="w-4 h-4 mr-1" /> Add payer
            </Button>
          ) : null
        }
      />

      <div className="border border-[#E8E5E0] rounded-md bg-[#FAFAF9] px-4 py-3 text-[13px] text-foreground">
        Changes here affect case creation and reporting immediately.
      </div>

      <div className="border border-[#E8E5E0] rounded-md overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
                {["Payer", "Active", "Avg decision", "Starter", ""].map((h, i) => (
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
                <TableSkeletonRows rows={8} cols={5} />
              ) : payersQ.isError ? (
                <tr>
                  <td colSpan={5} className="px-3 py-12 text-center">
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
                  <td colSpan={5} className="px-3 py-12">
                    <EmptyState message="No payers yet" />
                  </td>
                </tr>
              ) : (
                (payersQ.data ?? []).map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => canEdit && setEditing({ payer: p })}
                    className={`border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9] ${canEdit ? "cursor-pointer" : ""}`}
                  >
                    <td className="px-3 h-10 align-middle font-medium">{p.name}</td>
                    <td className="px-3 h-10 align-middle">
                      <YesNoPill value={p.isActive} />
                    </td>
                    <td className="px-3 h-10 align-middle text-muted-foreground">
                      {p.avgDecisionDays != null ? `${p.avgDecisionDays} d` : "—"}
                    </td>
                    <td className="px-3 h-10 align-middle" onClick={(e) => e.stopPropagation()}>
                      <StarterToggle
                        assignment={assignmentByPayer.get(p.id) ?? null}
                        payerName={p.name}
                        canEdit={canEdit}
                      />
                    </td>
                    <td
                      className="px-3 h-10 align-middle text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1.5">
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
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px] px-2"
                            onClick={() => setEditing({ payer: p })}
                          >
                            Edit
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? <PayerEditModal payer={editing.payer} onClose={() => setEditing(null)} /> : null}
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
  // pack, so no toggle is shown.
  if (!assignment) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <Switch
      checked={assignment.starter}
      disabled={!canEdit || setStarter.isPending}
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

function PayerEditModal({ payer, onClose }: { payer: Payer | null; onClose: () => void }) {
  const createMut = useCreatePayer();
  const updateMut = useUpdatePayer(payer?.id ?? "");
  const [form, setForm] = useState<PayerInput>(() =>
    payer
      ? {
          name: payer.name,
          isActive: payer.isActive,
          avgDecisionDays: payer.avgDecisionDays,
        }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const pending = createMut.isPending || updateMut.isPending;

  function patch(p: Partial<PayerInput>) {
    setForm((f) => ({ ...f, ...p }));
  }

  function numOrNull(v: string): number | null {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function save() {
    setError(null);
    setNameError(null);
    if (!form.name.trim()) {
      setNameError("Name is required");
      return;
    }
    try {
      if (payer) {
        await updateMut.mutateAsync(form);
        toast.success("Payer updated");
      } else {
        await createMut.mutateAsync(form);
        toast.success("Payer created");
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.error(msg);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{payer ? "Edit payer" : "Add payer"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label className="text-[12px]">Name</Label>
            <Input
              value={form.name}
              onChange={(e) => {
                patch({ name: e.target.value });
                if (nameError) setNameError(null);
              }}
              aria-invalid={nameError ? true : undefined}
              className={`h-9 ${nameError ? "border-[#B91C1C] focus-visible:ring-[#B91C1C]" : ""}`}
            />
            {nameError ? <div className="text-[12px] text-[#B91C1C] mt-1">{nameError}</div> : null}
          </div>

          <div className="col-span-2 flex items-center justify-between border border-[#E8E5E0] rounded-md px-3 py-2">
            <div>
              <div className="text-[13px] font-medium">Active</div>
              <div className="text-[12px] text-muted-foreground">
                Inactive payers are hidden from case creation.
              </div>
            </div>
            <Switch
              checked={Boolean(form.isActive)}
              onCheckedChange={(v) => patch({ isActive: v })}
            />
          </div>

          <div>
            <Label className="text-[12px]">Avg decision days</Label>
            <Input
              type="number"
              value={form.avgDecisionDays ?? ""}
              onChange={(e) => patch({ avgDecisionDays: numOrNull(e.target.value) })}
              className="h-9"
            />
          </div>
        </div>

        {error ? (
          <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={pending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {pending ? "Saving…" : payer ? "Save changes" : "Create payer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
