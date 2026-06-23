// Admin → Settings: two tabs. Organization (name, provider groups, facilities)
// and Team (memberships with role change for admins). No delete operations.
import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus, ChevronDown } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/externalClient';
import { camelizeRow } from '@/lib/case';
import {
  useActiveMembership,
  useActiveOrgId,
  useAuthStore,
  useRole,
  type AppRole,
} from '@/lib/auth-store';
import type { Facility, ProviderGroup } from '@/types';

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
});

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  'WI','WY','DC',
];

interface MembershipRow {
  id: string;
  orgId: string;
  userId: string;
  role: AppRole;
  createdAt: string;
  fullName: string | null;
  email: string | null;
}

function useOrganization() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['organization', orgId] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, created_at')
        .eq('id', orgId)
        .maybeSingle();
      if (error) throw error;
      return data ? camelizeRow<{ id: string; name: string; createdAt: string }>(data) : null;
    },
    enabled: orgId !== 'no-org',
  });
}

function useProviderGroupsList() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['provider-groups', orgId] as const,
    queryFn: async (): Promise<ProviderGroup[]> => {
      const { data, error } = await supabase
        .from('provider_groups')
        .select('*')
        .eq('org_id', orgId)
        .order('name');
      if (error) throw error;
      return camelizeRow<ProviderGroup[]>(data ?? []);
    },
    enabled: orgId !== 'no-org',
  });
}

function useFacilitiesList() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['facilities', orgId] as const,
    queryFn: async (): Promise<Facility[]> => {
      const { data, error } = await supabase
        .from('facilities')
        .select('*')
        .eq('org_id', orgId)
        .order('name');
      if (error) throw error;
      return camelizeRow<Facility[]>(data ?? []);
    },
    enabled: orgId !== 'no-org',
  });
}

function useMemberships() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['memberships-admin', orgId] as const,
    queryFn: async (): Promise<MembershipRow[]> => {
      const { data, error } = await supabase
        .from('memberships')
        .select('id, org_id, user_id, role, created_at, profiles(full_name, email)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const profile = row.profiles as { full_name: string | null; email: string | null } | null;
        return {
          id: row.id as string,
          orgId: row.org_id as string,
          userId: row.user_id as string,
          role: row.role as AppRole,
          createdAt: row.created_at as string,
          fullName: profile?.full_name ?? null,
          email: profile?.email ?? null,
        };
      });
    },
    enabled: orgId !== 'no-org',
  });
}

function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Group & Locations"
        description="Provider groups, facilities, insurance, and team."
      />
      <Tabs defaultValue="organization" className="w-full">
        <TabsList className="bg-[#FAFAF9] border border-[#E8E5E0] rounded-md">
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>
        <TabsContent value="organization" className="mt-6 space-y-6">
          <OrganizationTab />
        </TabsContent>
        <TabsContent value="team" className="mt-6">
          <TeamTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------ Organization ------------------------------ */

function OrganizationTab() {
  const role = useRole();
  const canEdit = role === 'admin';
  const orgQ = useOrganization();
  const groupsQ = useProviderGroupsList();
  const facilitiesQ = useFacilitiesList();
  const qc = useQueryClient();
  const orgId = useActiveOrgId();
  const loadMemberships = useAuthStore((s) => s.loadMemberships);

  const [name, setName] = useState<string>('');
  const [nameDirty, setNameDirty] = useState(false);
  const [nameErr, setNameErr] = useState<string | null>(null);

  const [groupModal, setGroupModal] = useState<{ group: ProviderGroup | null } | null>(null);
  const [facilityModal, setFacilityModal] = useState<{
    facility: Facility | null;
    defaultGroupId: string | null;
  } | null>(null);

  const orgName = orgQ.data?.name ?? '';
  const currentName = nameDirty ? name : orgName;

  const saveName = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('No active organization');
      const { error } = await supabase
        .from('organizations')
        .update({ name: currentName.trim() })
        .eq('id', orgId);
      if (error) throw error;
    },
    onSuccess: async () => {
      setNameDirty(false);
      setNameErr(null);
      toast.success('Organization name updated');
      await qc.invalidateQueries({ queryKey: ['organization', orgId ?? 'no-org'] });
      await loadMemberships();
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setNameErr(msg);
      toast.error(msg);
    },
  });

  const facilitiesByGroup = useMemo(() => {
    const m = new Map<string, Facility[]>();
    for (const f of facilitiesQ.data ?? []) {
      const key = f.groupId ?? '__none__';
      const arr = m.get(key) ?? [];
      arr.push(f);
      m.set(key, arr);
    }
    return m;
  }, [facilitiesQ.data]);

  return (
    <div className="space-y-6">
      {/* Org name */}
      <section className="border border-[#E8E5E0] rounded-md bg-white p-4">
        <h2 className="text-[15px] font-semibold mb-3">Organization</h2>
        <div className="flex items-end gap-3 max-w-xl">
          <div className="flex-1">
            <Label className="text-[12px]">Name</Label>
            <Input
              value={currentName}
              disabled={!canEdit || orgQ.isLoading}
              onChange={(e) => {
                setName(e.target.value);
                setNameDirty(true);
              }}
              className="h-9"
            />
          </div>
          <Button
            disabled={
              !canEdit ||
              !nameDirty ||
              saveName.isPending ||
              !currentName.trim()
            }
            onClick={() => saveName.mutate()}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
          >
            {saveName.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {nameErr ? (
          <div className="mt-2 text-[12px] text-[#B91C1C]">{nameErr}</div>
        ) : null}
      </section>

      {/* Provider groups */}
      <section className="border border-[#E8E5E0] rounded-md bg-white">
        <div className="flex items-center justify-between p-4 border-b border-[#E8E5E0]">
          <h2 className="text-[15px] font-semibold">Provider groups</h2>
          {canEdit && (
            <Button
              size="sm"
              onClick={() => setGroupModal({ group: null })}
              className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-8"
            >
              <Plus className="w-4 h-4 mr-1" /> Add group
            </Button>
          )}
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
              {['Name', 'TIN', 'Group NPI', 'States', 'Active', ''].map((h, i) => (
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
            {groupsQ.isLoading ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : (groupsQ.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted-foreground">
                  No provider groups yet.
                </td>
              </tr>
            ) : (
              (groupsQ.data ?? []).map((g) => (
                <tr
                  key={g.id}
                  className="border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9]"
                >
                  <td className="px-3 h-10 align-middle font-medium">{g.name}</td>
                  <td className="px-3 h-10 align-middle text-muted-foreground">
                    {g.tin ?? '—'}
                  </td>
                  <td className="px-3 h-10 align-middle text-muted-foreground">
                    {g.npiType2 ?? '—'}
                  </td>
                  <td className="px-3 h-10 align-middle text-muted-foreground">
                    {g.states && g.states.length > 0 ? g.states.join(', ') : '—'}
                  </td>
                  <td className="px-3 h-10 align-middle">
                    {g.isActive ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border bg-[#F5F5F4] text-[#57534E] border-[#E8E5E0]">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-3 h-10 align-middle text-right">
                    {canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px] px-2"
                        onClick={() => setGroupModal({ group: g })}
                      >
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* Facilities grouped */}
      <section className="border border-[#E8E5E0] rounded-md bg-white">
        <div className="flex items-center justify-between p-4 border-b border-[#E8E5E0]">
          <h2 className="text-[15px] font-semibold">Facilities</h2>
          {canEdit && (
            <Button
              size="sm"
              onClick={() =>
                setFacilityModal({ facility: null, defaultGroupId: null })
              }
              className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-8"
            >
              <Plus className="w-4 h-4 mr-1" /> Add facility
            </Button>
          )}
        </div>
        <div className="divide-y divide-[#E8E5E0]">
          {[
            ...(groupsQ.data ?? []).map((g) => ({ id: g.id, name: g.name })),
            { id: '__none__', name: 'Unassigned' },
          ].map((g) => {
            const list = facilitiesByGroup.get(g.id) ?? [];
            if (list.length === 0 && g.id === '__none__') return null;
            return (
              <div key={g.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[13px] font-medium text-foreground">
                    {g.name}
                    <span className="ml-2 text-muted-foreground font-normal">
                      ({list.length})
                    </span>
                  </div>
                  {canEdit && g.id !== '__none__' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px] px-2"
                      onClick={() =>
                        setFacilityModal({
                          facility: null,
                          defaultGroupId: g.id,
                        })
                      }
                    >
                      Add to group
                    </Button>
                  )}
                </div>
                {list.length === 0 ? (
                  <div className="text-[12px] text-muted-foreground">
                    No facilities.
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {list.map((f) => (
                      <li
                        key={f.id}
                        className="flex items-center justify-between border border-[#E8E5E0] rounded-md px-3 py-2 hover:bg-[#FAFAF9]"
                      >
                        <div>
                          <div className="text-[13px] font-medium">{f.name}</div>
                          <div className="text-[12px] text-muted-foreground">
                            {[f.street, f.city, f.state, f.zip]
                              .filter(Boolean)
                              .join(', ') || '—'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {f.isActive ? null : (
                            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                              Inactive
                            </span>
                          )}
                          {canEdit && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-[11px] px-2"
                              onClick={() =>
                                setFacilityModal({
                                  facility: f,
                                  defaultGroupId: f.groupId,
                                })
                              }
                            >
                              Edit
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {g.id !== '__none__' ? (
                  <div className="mt-4">
                    <InsurancePoliciesSection groupId={g.id} canEdit={canEdit} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {groupModal ? (
        <GroupEditModal
          group={groupModal.group}
          onClose={() => setGroupModal(null)}
        />
      ) : null}
      {facilityModal ? (
        <FacilityEditModal
          facility={facilityModal.facility}
          defaultGroupId={facilityModal.defaultGroupId}
          groups={groupsQ.data ?? []}
          onClose={() => setFacilityModal(null)}
        />
      ) : null}
    </div>
  );
}

function GroupEditModal({
  group,
  onClose,
}: {
  group: ProviderGroup | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId();
  const [name, setName] = useState(group?.name ?? '');
  const [tin, setTin] = useState(group?.tin ?? '');
  const [npi, setNpi] = useState(group?.npiType2 ?? '');
  const [states, setStates] = useState<string>(group?.states?.join(', ') ?? '');
  const [active, setActive] = useState<boolean>(group?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('No active organization');
      if (!name.trim()) throw new Error('Name is required');
      const stateArr = states
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      const payload = {
        org_id: orgId,
        name: name.trim(),
        tin: tin.trim() || null,
        npi_type2: npi.trim() || null,
        states: stateArr.length > 0 ? stateArr : null,
        is_active: active,
      };
      if (group) {
        const { error } = await supabase
          .from('provider_groups')
          .update(payload as never)
          .eq('id', group.id)
          .eq('org_id', orgId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('provider_groups')
          .insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider-groups', orgId ?? 'no-org'] });
      toast.success(group ? 'Group updated' : 'Group created');
      onClose();
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      toast.error(msg);
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{group ? 'Edit provider group' : 'Add provider group'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-[12px]">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px]">TIN</Label>
              <Input value={tin} onChange={(e) => setTin(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-[12px]">Group NPI</Label>
              <Input value={npi} onChange={(e) => setNpi(e.target.value)} className="h-9" />
            </div>
          </div>
          <div>
            <Label className="text-[12px]">States (comma separated)</Label>
            <Input
              value={states}
              onChange={(e) => setStates(e.target.value)}
              placeholder="TX, CA, NY"
              className="h-9"
            />
          </div>
          <div className="flex items-center justify-between border border-[#E8E5E0] rounded-md px-3 py-2">
            <div className="text-[13px] font-medium">Active</div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
          {error ? (
            <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {mut.isPending ? 'Saving…' : group ? 'Save changes' : 'Create group'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FacilityEditModal({
  facility,
  defaultGroupId,
  groups,
  onClose,
}: {
  facility: Facility | null;
  defaultGroupId: string | null;
  groups: ProviderGroup[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId();
  const [name, setName] = useState(facility?.name ?? '');
  const [groupId, setGroupId] = useState<string>(
    facility?.groupId ?? defaultGroupId ?? '__none__',
  );
  const [street, setStreet] = useState(facility?.street ?? '');
  const [city, setCity] = useState(facility?.city ?? '');
  const [state, setState] = useState<string>(facility?.state ?? '__none__');
  const [zip, setZip] = useState(facility?.zip ?? '');
  const [active, setActive] = useState<boolean>(facility?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('No active organization');
      if (!name.trim()) throw new Error('Name is required');
      const payload = {
        org_id: orgId,
        name: name.trim(),
        group_id: groupId === '__none__' ? null : groupId,
        street: street.trim() || null,
        city: city.trim() || null,
        state: state === '__none__' ? null : state,
        zip: zip.trim() || null,
        is_active: active,
      };
      if (facility) {
        const { error } = await supabase
          .from('facilities')
          .update(payload as never)
          .eq('id', facility.id)
          .eq('org_id', orgId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('facilities')
          .insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facilities', orgId ?? 'no-org'] });
      toast.success(facility ? 'Facility updated' : 'Facility created');
      onClose();
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      toast.error(msg);
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{facility ? 'Edit facility' : 'Add facility'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-[12px]">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-[12px]">Provider group</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="h-9 w-full" title={groups.find((g) => g.id === groupId)?.name ?? 'Unassigned'}>
                <SelectValue className="truncate" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id} title={g.name}>
                    <span className="truncate block max-w-[360px]">{g.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12px]">Street</Label>
            <Input value={street} onChange={(e) => setStreet(e.target.value)} className="h-9" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-[12px]">City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-[12px]">State</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px]">ZIP</Label>
              <Input value={zip} onChange={(e) => setZip(e.target.value)} className="h-9" />
            </div>
          </div>
          <div className="flex items-center justify-between border border-[#E8E5E0] rounded-md px-3 py-2">
            <div className="text-[13px] font-medium">Active</div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
          {error ? (
            <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {mut.isPending ? 'Saving…' : facility ? 'Save changes' : 'Create facility'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- Team ---------------------------------- */

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

function TeamTab() {
  const role = useRole();
  const canEdit = role === 'admin';
  const me = useActiveMembership();
  const membershipsQ = useMemberships();
  const qc = useQueryClient();
  const orgId = useActiveOrgId();

  const updateRole = useMutation({
    mutationFn: async ({ id, role: newRole }: { id: string; role: AppRole }) => {
      if (!orgId) throw new Error('No active organization');
      const { error } = await supabase
        .from('memberships')
        .update({ role: newRole })
        .eq('id', id)
        .eq('org_id', orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships-admin', orgId ?? 'no-org'] });
      toast.success('Role updated');
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Role update failed');
    },
  });

  return (
    <div className="space-y-4">
      <div className="border border-[#E8E5E0] rounded-md bg-[#FAFAF9] px-4 py-3 text-[13px] text-foreground">
        Billing role is read-only everywhere. This is enforced by the database,
        not just the interface.
      </div>

      <div className="flex items-center justify-end">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button disabled className="bg-[#1B4D3E] text-white h-9 opacity-60">
                  <Plus className="w-4 h-4 mr-1" /> Invite
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Invites come with email automation later.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="border border-[#E8E5E0] rounded-md overflow-hidden bg-white">
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
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : (membershipsQ.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground">
                  No members.
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
                      {m.createdAt ? format(new Date(m.createdAt), 'MMM d, yyyy') : '—'}
                    </td>
                    <td className="px-3 h-10 align-middle text-right">
                      {canEdit ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) =>
                            updateRole.mutate({ id: m.id, role: v as AppRole })
                          }
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

/* --------------------------- Insurance Policies --------------------------- */

type InsuranceType = 'professional_liability' | 'general_liability';

interface InsurancePolicy {
  id: string;
  orgId: string;
  groupId: string;
  insuranceType: InsuranceType;
  insurerName: string;
  policyNumber: string;
  policyStartDate: string;
  policyEndDate: string;
  notes: string | null;
}

function useGroupInsurancePolicies(groupId: string) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['group-insurance-policies', orgId, groupId] as const,
    queryFn: async (): Promise<InsurancePolicy[]> => {
      const { data, error } = await supabase
        .from('group_insurance_policies' as never)
        .select('*')
        .eq('org_id', orgId)
        .eq('group_id', groupId)
        .order('policy_end_date', { ascending: false });
      if (error) throw error;
      return camelizeRow<InsurancePolicy[]>((data ?? []) as never);
    },
    enabled: orgId !== 'no-org' && Boolean(groupId),
  });
}

function insuranceTypeLabel(t: InsuranceType): string {
  return t === 'professional_liability' ? 'Professional Liability' : 'General Liability';
}

function policyStatus(start: string, end: string): { label: string; cls: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const s = new Date(start);
  const e = new Date(end);
  if (today < s) {
    return {
      label: 'Future',
      cls: 'bg-[#F5F5F4] text-[#9CA3AF] border-[#E8E5E0]',
    };
  }
  if (today > e) {
    return {
      label: 'Expired',
      cls: 'bg-[#FEF2F2] text-[#DC2626] border-[#FCA5A5]',
    };
  }
  return {
    label: 'Active',
    cls: 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]',
  };
}

function InsurancePoliciesSection({
  groupId,
  canEdit,
}: {
  groupId: string;
  canEdit: boolean;
}) {
  const policiesQ = useGroupInsurancePolicies(groupId);
  const [modal, setModal] = useState<{ policy: InsurancePolicy | null } | null>(null);

  return (
    <div className="border border-[#E8E5E0] rounded-md bg-white">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#E8E5E0]">
        <div className="text-[13px] font-semibold">Insurance Policies</div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setModal({ policy: null })}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-7 text-[11px] px-2"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Policy
          </Button>
        )}
      </div>
      {policiesQ.isLoading ? (
        <div className="p-4 text-[12px] text-muted-foreground">Loading…</div>
      ) : (policiesQ.data ?? []).length === 0 ? (
        <div className="p-4 text-[12px] text-muted-foreground">
          No insurance policies. Add a policy to track group coverage.
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
              {['Type', 'Insurer', 'Policy #', 'Start Date', 'End Date', 'Status'].map(
                (h, i) => (
                  <th
                    key={i}
                    className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {(policiesQ.data ?? []).map((p) => {
              const status = policyStatus(p.policyStartDate, p.policyEndDate);
              return (
                <tr
                  key={p.id}
                  onClick={() => canEdit && setModal({ policy: p })}
                  className={`border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9] ${
                    canEdit ? 'cursor-pointer' : ''
                  }`}
                >
                  <td className="px-3 h-10 align-middle">{insuranceTypeLabel(p.insuranceType)}</td>
                  <td className="px-3 h-10 align-middle font-medium">{p.insurerName}</td>
                  <td className="px-3 h-10 align-middle text-muted-foreground">
                    {p.policyNumber}
                  </td>
                  <td className="px-3 h-10 align-middle text-muted-foreground">
                    {format(new Date(p.policyStartDate), 'MMM d, yyyy')}
                  </td>
                  <td className="px-3 h-10 align-middle text-muted-foreground">
                    {format(new Date(p.policyEndDate), 'MMM d, yyyy')}
                  </td>
                  <td className="px-3 h-10 align-middle">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border ${status.cls}`}
                    >
                      {status.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {modal ? (
        <InsurancePolicyEditModal
          groupId={groupId}
          policy={modal.policy}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

function InsurancePolicyEditModal({
  groupId,
  policy,
  onClose,
}: {
  groupId: string;
  policy: InsurancePolicy | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId();
  const [insuranceType, setInsuranceType] = useState<InsuranceType>(
    policy?.insuranceType ?? 'professional_liability',
  );
  const [insurerName, setInsurerName] = useState(policy?.insurerName ?? '');
  const [policyNumber, setPolicyNumber] = useState(policy?.policyNumber ?? '');
  const [startDate, setStartDate] = useState(policy?.policyStartDate ?? '');
  const [endDate, setEndDate] = useState(policy?.policyEndDate ?? '');
  const [notes, setNotes] = useState(policy?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('No active organization');
      if (!insurerName.trim()) throw new Error('Insurer name is required');
      if (!policyNumber.trim()) throw new Error('Policy number is required');
      if (!startDate) throw new Error('Start date is required');
      if (!endDate) throw new Error('End date is required');
      const payload = {
        org_id: orgId,
        group_id: groupId,
        insurance_type: insuranceType,
        insurer_name: insurerName.trim(),
        policy_number: policyNumber.trim(),
        policy_start_date: startDate,
        policy_end_date: endDate,
        notes: notes.trim() || null,
      };
      if (policy) {
        const { error: err } = await supabase
          .from('group_insurance_policies' as never)
          .update(payload as never)
          .eq('id', policy.id)
          .eq('org_id', orgId);
        if (err) throw err;
      } else {
        const { error: err } = await supabase
          .from('group_insurance_policies' as never)
          .insert(payload as never);
        if (err) throw err;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['group-insurance-policies', orgId ?? 'no-org', groupId],
      });
      toast.success(policy ? 'Policy updated' : 'Policy created');
      onClose();
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      toast.error(msg);
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{policy ? 'Edit policy' : 'Add policy'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-[12px]">Insurance Type</Label>
            <Select
              value={insuranceType}
              onValueChange={(v) => setInsuranceType(v as InsuranceType)}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="professional_liability">Professional Liability</SelectItem>
                <SelectItem value="general_liability">General Liability</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12px]">Insurer Name</Label>
            <Input
              value={insurerName}
              onChange={(e) => setInsurerName(e.target.value)}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-[12px]">Policy #</Label>
            <Input
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px]">Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-[12px]">End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9"
              />
            </div>
          </div>
          <div>
            <Label className="text-[12px]">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          {error ? (
            <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {mut.isPending ? 'Saving…' : policy ? 'Save changes' : 'Create policy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
