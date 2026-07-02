// Team members table with inline role change for admins.
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TableSkeletonRows } from '@/components/TableSkeletonRows';
import { EmptyState } from '@/components/EmptyState';
import { fmtDate } from '@/lib/format';
import { useActiveMembership, type AppRole } from '@/lib/auth-store';
import { useIsAdmin } from '@/lib/permissions';
import { useMemberships, useUpdateMembershipRole } from '@/hooks/useOrgSettings';

function roleBadge(role: AppRole) {
  if (role === 'specialist') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]">
        Specialist
      </span>
    );
  }
  if (role === 'billing') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border bg-[#F5F5F4] text-[#57534E] border-[#E8E5E0]">
        Billing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border bg-[#E7F0EC] text-[#1B4D3E] border-[#C8DBD4]">
      Admin
    </span>
  );
}

export function MembersPanel() {
  const canEdit = useIsAdmin();
  const me = useActiveMembership();
  const membershipsQ = useMemberships();

  const updateRole = useUpdateMembershipRole();

  const handleRoleChange = (id: string, newRole: AppRole) => {
    updateRole.mutate(
      { id, role: newRole },
      {
        onSuccess: () => toast.success('Role updated'),
        onError: (e) => {
          const msg = e instanceof Error ? e.message : 'Update failed';
          toast.error(msg);
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="border border-[#E8E5E0] rounded-md bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
              {['Name', 'Email', 'Role', 'Joined', ''].map((h, i) => (
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
                const isSelf = me?.orgId === m.orgId && me?.role === m.role && false;
                void isSelf;
                return (
                  <tr
                    key={m.id}
                    className="border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9]"
                  >
                    <td className="px-3 h-10 align-middle font-medium">
                      {m.fullName ?? '—'}
                    </td>
                    <td className="px-3 h-10 align-middle text-muted-foreground">
                      {m.email ?? '—'}
                    </td>
                    <td className="px-3 h-10 align-middle">{roleBadge(m.role)}</td>
                    <td className="px-3 h-10 align-middle text-muted-foreground">
                      {fmtDate(m.createdAt)}
                    </td>
                    <td className="px-3 h-10 align-middle text-right">
                      {canEdit ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) => handleRoleChange(m.id, v as AppRole)}
                        >
                          <SelectTrigger className="h-8 w-[140px] ml-auto text-[12px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="specialist">Specialist</SelectItem>
                            <SelectItem value="billing">Billing</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
