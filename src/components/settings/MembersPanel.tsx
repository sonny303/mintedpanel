// Team members table: role changes and removal. The "Invite member" flow was
// removed from MVP by user request (2026-07-19) — UI only: the pending_invites
// table, claim_invites() login RPC, and the invites service/hooks stay intact
// so the capability can return post-MVP. The Pending invites table renders
// ONLY when legacy rows exist (they stay revocable and claimable at login);
// with none, the section disappears instead of showing a dead empty state.
// Admin-only mutations; every mutation surfaces success/error via toast.
// 2026-07-21 (user handoff Task B): no longer a standalone Org Detail section
// — rendered INSIDE PartiesManager's "Access" subgroup, which supplies the
// heading/framing (the old "Manage who has access" helper line is gone).
// Capability and permission rules are bit-identical.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { fmtDate } from "@/lib/format";
import { useAuthStore, useActiveMembership, type AppRole } from "@/lib/auth-store";
import { useIsAdmin } from "@/lib/permissions";
import { useMemberships, useUpdateMembershipRole } from "@/hooks/useOrgSettings";
import { usePendingInvites, useRemoveMembership, useRevokePendingInvite } from "@/hooks/useInvites";
import type { PendingInvite } from "@/services/invites";
import type { MembershipRow } from "@/services/orgSettings";

function roleBadge(role: AppRole) {
  if (role === "specialist") return <StatusPill status="green" label="Specialist" />;
  if (role === "billing") return <StatusPill status="neutral" label="Billing" />;
  return <StatusPill status="brand" label="Admin" />;
}

function RemoveMemberDialog({
  member,
  onClose,
}: {
  member: MembershipRow | null;
  onClose: () => void;
}) {
  const remove = useRemoveMembership();
  const submitting = remove.isPending;
  const handleConfirm = () => {
    if (!member) return;
    remove.mutate(
      { id: member.id, email: member.email, role: member.role },
      {
        onSuccess: () => {
          toast.success("Member removed");
          onClose();
        },
        onError: (e) => {
          toast.error(e instanceof Error ? e.message : "Failed to remove member");
        },
      },
    );
  };
  return (
    <Dialog
      open={Boolean(member)}
      onOpenChange={(v) => {
        if (!v && !submitting) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove team member?</DialogTitle>
          <DialogDescription>
            {member?.fullName ?? member?.email ?? "This member"} will lose access to this
            organization. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting}
            className="bg-[#B91C1C] text-white hover:opacity-90"
          >
            {submitting ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MembersPanel() {
  const canEdit = useIsAdmin();
  const me = useActiveMembership();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const membershipsQ = useMemberships();
  const invitesQ = usePendingInvites();
  const updateRole = useUpdateMembershipRole();
  const revokeInvite = useRevokePendingInvite();

  const [removeTarget, setRemoveTarget] = useState<MembershipRow | null>(null);

  const handleRoleChange = (id: string, newRole: AppRole) => {
    updateRole.mutate(
      { id, role: newRole },
      {
        onSuccess: () => toast.success("Role updated"),
        onError: (e) => {
          const msg = e instanceof Error ? e.message : "Update failed";
          toast.error(msg);
        },
      },
    );
  };

  const handleRevoke = (invite: PendingInvite) => {
    revokeInvite.mutate(invite, {
      onSuccess: () => toast.success(`Invite for ${invite.email} revoked`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to revoke invite"),
    });
  };

  void me;

  return (
    <div className="space-y-6">
      <div className="border border-[#E8E5E0] rounded-md bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
              {["Name", "Email", "Role", "Joined", ""].map((h, i) => (
                <th
                  key={i}
                  className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {membershipsQ.isLoading ? (
              <TableSkeletonRows rows={6} cols={5} />
            ) : membershipsQ.isError ? (
              <tr>
                <td colSpan={5} className="px-3 py-12 text-center">
                  <EmptyState
                    message="Failed to load team members"
                    action={
                      <Button variant="outline" size="sm" onClick={() => membershipsQ.refetch()}>
                        Retry
                      </Button>
                    }
                  />
                </td>
              </tr>
            ) : (membershipsQ.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-12">
                  <EmptyState message="No members yet" />
                </td>
              </tr>
            ) : (
              (membershipsQ.data ?? []).map((m) => {
                const isSelf = currentUserId != null && m.userId === currentUserId;
                return (
                  <tr
                    key={m.id}
                    className="border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9]"
                  >
                    <td className="px-3 h-10 align-middle font-medium">{m.fullName ?? "—"}</td>
                    <td className="px-3 h-10 align-middle text-muted-foreground">
                      {m.email ?? "—"}
                    </td>
                    <td className="px-3 h-10 align-middle">{roleBadge(m.role)}</td>
                    <td className="px-3 h-10 align-middle text-muted-foreground">
                      {fmtDate(m.createdAt)}
                    </td>
                    <td className="px-3 h-10 align-middle text-right">
                      {canEdit ? (
                        <div className="flex items-center justify-end gap-2">
                          <Select
                            value={m.role}
                            onValueChange={(v) => handleRoleChange(m.id, v as AppRole)}
                          >
                            <SelectTrigger className="h-8 w-[130px] text-[12px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="specialist">Specialist</SelectItem>
                              <SelectItem value="billing">Billing</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                          {isSelf ? null : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-[12px] text-[#B91C1C] border-[#E8E5E0] hover:bg-[#FEF2F2]"
                              onClick={() => setRemoveTarget(m)}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {(invitesQ.data ?? []).length > 0 ? (
        <div>
          <h3 className="text-[13px] font-medium text-[#1B4D3E] mb-2">Pending invites</h3>
          <div className="border border-[#E8E5E0] rounded-md bg-white">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
                  {["Email", "Role", "Invited", ""].map((h, i) => (
                    <th
                      key={i}
                      className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(invitesQ.data ?? []).map((invite) => (
                  <tr
                    key={invite.id}
                    className="border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9]"
                  >
                    <td className="px-3 h-10 align-middle font-medium">{invite.email}</td>
                    <td className="px-3 h-10 align-middle">{roleBadge(invite.role)}</td>
                    <td className="px-3 h-10 align-middle text-muted-foreground">
                      {fmtDate(invite.createdAt)}
                    </td>
                    <td className="px-3 h-10 align-middle text-right">
                      {canEdit ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-[12px] text-[#B91C1C] border-[#E8E5E0] hover:bg-[#FEF2F2]"
                          onClick={() => handleRevoke(invite)}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <RemoveMemberDialog member={removeTarget} onClose={() => setRemoveTarget(null)} />
    </div>
  );
}
