// Admin → Settings: two tabs. Organization (name, provider groups, facilities)
// and Team (memberships with role change for admins). No delete operations.
import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { fmtDate } from '@/lib/format';
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
import { useActiveMembership, type AppRole } from '@/lib/auth-store';
import { useIsAdmin } from '@/lib/permissions';
import { useProviderGroups } from '@/hooks/useLookups';
import {
  useCreateFacility,
  useCreateGroupInsurancePolicy,
  useCreateProviderGroup,
  useFacilitiesAll,
  useGroupInsurancePolicies,
  useMemberships,
  useOrganization,
  useUpdateFacility,
  useUpdateGroupInsurancePolicy,
  useUpdateMembershipRole,
  useUpdateOrganizationName,
  useUpdateProviderGroup,
} from '@/hooks/useOrgSettings';
import type {
  FacilityInput,
  InsurancePolicy,
  InsurancePolicyInput,
  InsuranceType,
  ProviderGroupInput,
} from '@/services/orgSettings';
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
  const canEdit = useIsAdmin();
  const orgQ = useOrganization();
  const groupsQ = useProviderGroups();
  const facilitiesQ = useFacilitiesAll();

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

  const saveName = useUpdateOrganizationName();

  const handleSaveName = () => {
    setNameErr(null);
    saveName.mutate(currentName, {
      onSuccess: () => {
        setNameDirty(false);
        toast.success('Organization name updated');
      },
      onError: (e) => {
        const msg = e instanceof Error ? e.message : 'Save failed';
        setNameErr(msg);
        toast.error(msg);
      },
    });
  };

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
            onClick={handleSaveName}
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
            ) : groupsQ.isError ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center">
                  <div className="text-[13px] text-foreground mb-3">Failed to load provider groups.</div>
                  <Button variant="outline" size="sm" onClick={() => groupsQ.refetch()}>
                    Retry
                  </Button>
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
  const g = (group ?? {}) as Record<string, unknown>;
  const initStr = (k: string) => (typeof g[k] === 'string' ? (g[k] as string) : '');
  const [name, setName] = useState(group?.name ?? '');
  const [tin, setTin] = useState(group?.tin ?? '');
  const [npi, setNpi] = useState(group?.npiType2 ?? '');
  const [states, setStates] = useState<string>(group?.states?.join(', ') ?? '');
  const [active, setActive] = useState<boolean>(group?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const [billStreet, setBillStreet] = useState(initStr('billingStreet'));
  const [billCity, setBillCity] = useState(initStr('billingCity'));
  const [billState, setBillState] = useState(initStr('billingState'));
  const [billZip, setBillZip] = useState(initStr('billingZip'));

  const [corrStreet, setCorrStreet] = useState(initStr('correspondenceStreet'));
  const [corrCity, setCorrCity] = useState(initStr('correspondenceCity'));
  const [corrState, setCorrState] = useState(initStr('correspondenceState'));
  const [corrZip, setCorrZip] = useState(initStr('correspondenceZip'));

  const initialSame =
    Boolean(group) &&
    (initStr('correspondenceStreet') !== '' || initStr('correspondenceCity') !== '') &&
    initStr('correspondenceStreet') === initStr('billingStreet') &&
    initStr('correspondenceCity') === initStr('billingCity') &&
    initStr('correspondenceState') === initStr('billingState') &&
    initStr('correspondenceZip') === initStr('billingZip');
  const [sameAsBilling, setSameAsBilling] = useState<boolean>(initialSame);

  const [billingOpen, setBillingOpen] = useState(false);
  const [corrOpen, setCorrOpen] = useState(false);

  const onToggleSame = (v: boolean) => {
    setSameAsBilling(v);
    if (v) {
      setCorrStreet(billStreet);
      setCorrCity(billCity);
      setCorrState(billState);
      setCorrZip(billZip);
    }
  };

  const createMut = useCreateProviderGroup();
  const updateMut = useUpdateProviderGroup(group?.id ?? '');
  const pending = createMut.isPending || updateMut.isPending;

  const handleSave = () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    const stateArr = states
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const cs = sameAsBilling ? billStreet : corrStreet;
    const cc = sameAsBilling ? billCity : corrCity;
    const cst = sameAsBilling ? billState : corrState;
    const cz = sameAsBilling ? billZip : corrZip;
    const input: ProviderGroupInput = {
      name: name.trim(),
      tin: tin.trim() || null,
      npiType2: npi.trim() || null,
      states: stateArr.length > 0 ? stateArr : null,
      isActive: active,
      billingStreet: billStreet.trim() || null,
      billingCity: billCity.trim() || null,
      billingState: billState || null,
      billingZip: billZip.trim() || null,
      correspondenceStreet: cs.trim() || null,
      correspondenceCity: cc.trim() || null,
      correspondenceState: cst || null,
      correspondenceZip: cz.trim() || null,
    };
    const onErr = (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      toast.error(msg);
    };
    if (group) {
      updateMut.mutate(input, {
        onSuccess: () => {
          toast.success('Group updated');
          onClose();
        },
        onError: onErr,
      });
    } else {
      createMut.mutate(input, {
        onSuccess: () => {
          toast.success('Group created');
          onClose();
        },
        onError: onErr,
      });
    }
  };

  const renderStateSelect = (value: string, onChange: (v: string) => void, disabled = false) => (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 rounded-[4px]">
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {US_STATES.map((s) => (
          <SelectItem key={s} value={s}>{s}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const sectionTriggerCls =
    'flex w-full items-center justify-between border border-[#E8E5E0] rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#FAFAF9] [&[data-state=open]>svg]:rotate-180';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border-[#E8E5E0] shadow-none max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{group ? 'Edit provider group' : 'Add provider group'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-[12px] uppercase tracking-wider">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-[4px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px] uppercase tracking-wider">TIN</Label>
              <Input value={tin} onChange={(e) => setTin(e.target.value)} className="h-9 rounded-[4px]" />
            </div>
            <div>
              <Label className="text-[12px] uppercase tracking-wider">Group NPI</Label>
              <Input value={npi} onChange={(e) => setNpi(e.target.value)} className="h-9 rounded-[4px]" />
            </div>
          </div>
          <div>
            <Label className="text-[12px] uppercase tracking-wider">States (comma separated)</Label>
            <Input
              value={states}
              onChange={(e) => setStates(e.target.value)}
              placeholder="TX, CA, NY"
              className="h-9 rounded-[4px]"
            />
          </div>

          <Collapsible open={billingOpen} onOpenChange={setBillingOpen}>
            <CollapsibleTrigger className={sectionTriggerCls}>
              <span>Billing address</span>
              <ChevronDown className="h-4 w-4 text-[#6B7280] transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-3">
              <p className="text-[12px] text-[#6B7280]">Where payers send checks and EOBs.</p>
              <div>
                <Label className="text-[12px] uppercase tracking-wider">Street</Label>
                <Input value={billStreet} onChange={(e) => setBillStreet(e.target.value)} className="h-9 rounded-[4px]" />
              </div>
              <div className="grid grid-cols-[1fr_120px_120px] gap-3">
                <div>
                  <Label className="text-[12px] uppercase tracking-wider">City</Label>
                  <Input value={billCity} onChange={(e) => setBillCity(e.target.value)} className="h-9 rounded-[4px]" />
                </div>
                <div>
                  <Label className="text-[12px] uppercase tracking-wider">State</Label>
                  {renderStateSelect(billState, setBillState)}
                </div>
                <div>
                  <Label className="text-[12px] uppercase tracking-wider">Zip</Label>
                  <Input value={billZip} onChange={(e) => setBillZip(e.target.value)} className="h-9 rounded-[4px]" />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={corrOpen} onOpenChange={setCorrOpen}>
            <CollapsibleTrigger className={sectionTriggerCls}>
              <span>Correspondence address</span>
              <ChevronDown className="h-4 w-4 text-[#6B7280] transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-3">
              <p className="text-[12px] text-[#6B7280]">Where payers send credentialing mail.</p>
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox
                  checked={sameAsBilling}
                  onCheckedChange={(v) => onToggleSame(v === true)}
                />
                <span>Same as billing address</span>
              </label>
              <div>
                <Label className="text-[12px] uppercase tracking-wider">Street</Label>
                <Input
                  value={sameAsBilling ? billStreet : corrStreet}
                  onChange={(e) => setCorrStreet(e.target.value)}
                  disabled={sameAsBilling}
                  className="h-9 rounded-[4px]"
                />
              </div>
              <div className="grid grid-cols-[1fr_120px_120px] gap-3">
                <div>
                  <Label className="text-[12px] uppercase tracking-wider">City</Label>
                  <Input
                    value={sameAsBilling ? billCity : corrCity}
                    onChange={(e) => setCorrCity(e.target.value)}
                    disabled={sameAsBilling}
                    className="h-9 rounded-[4px]"
                  />
                </div>
                <div>
                  <Label className="text-[12px] uppercase tracking-wider">State</Label>
                  {renderStateSelect(
                    sameAsBilling ? billState : corrState,
                    setCorrState,
                    sameAsBilling,
                  )}
                </div>
                <div>
                  <Label className="text-[12px] uppercase tracking-wider">Zip</Label>
                  <Input
                    value={sameAsBilling ? billZip : corrZip}
                    onChange={(e) => setCorrZip(e.target.value)}
                    disabled={sameAsBilling}
                    className="h-9 rounded-[4px]"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

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
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {pending ? 'Saving…' : group ? 'Save changes' : 'Create group'}
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

  const createMut = useCreateFacility();
  const updateMut = useUpdateFacility(facility?.id ?? '');
  const pending = createMut.isPending || updateMut.isPending;

  const handleSave = () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    const input: FacilityInput = {
      name: name.trim(),
      groupId: groupId === '__none__' ? null : groupId,
      street: street.trim() || null,
      city: city.trim() || null,
      state: state === '__none__' ? null : state,
      zip: zip.trim() || null,
      isActive: active,
    };
    const onErr = (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      toast.error(msg);
    };
    if (facility) {
      updateMut.mutate(input, {
        onSuccess: () => {
          toast.success('Facility updated');
          onClose();
        },
        onError: onErr,
      });
    } else {
      createMut.mutate(input, {
        onSuccess: () => {
          toast.success('Facility created');
          onClose();
        },
        onError: onErr,
      });
    }
  };

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
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {pending ? 'Saving…' : facility ? 'Save changes' : 'Create facility'}
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
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : membershipsQ.isError ? (
              <tr>
                <td colSpan={5} className="px-3 py-12 text-center">
                  <div className="text-[13px] text-foreground mb-3">Failed to load team members.</div>
                  <Button variant="outline" size="sm" onClick={() => membershipsQ.refetch()}>
                    Retry
                  </Button>
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

/* --------------------------- Insurance Policies --------------------------- */

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
      ) : policiesQ.isError ? (
        <div className="p-6 text-center">
          <div className="text-[13px] text-foreground mb-3">Failed to load insurance policies.</div>
          <Button variant="outline" size="sm" onClick={() => policiesQ.refetch()}>
            Retry
          </Button>
        </div>
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
                    {fmtDate(p.policyStartDate)}
                  </td>
                  <td className="px-3 h-10 align-middle text-muted-foreground">
                    {fmtDate(p.policyEndDate)}
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
  const [insuranceType, setInsuranceType] = useState<InsuranceType>(
    policy?.insuranceType ?? 'professional_liability',
  );
  const [insurerName, setInsurerName] = useState(policy?.insurerName ?? '');
  const [policyNumber, setPolicyNumber] = useState(policy?.policyNumber ?? '');
  const [startDate, setStartDate] = useState(policy?.policyStartDate ?? '');
  const [endDate, setEndDate] = useState(policy?.policyEndDate ?? '');
  const [notes, setNotes] = useState(policy?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const createMut = useCreateGroupInsurancePolicy(groupId);
  const updateMut = useUpdateGroupInsurancePolicy(policy?.id ?? '', groupId);
  const pending = createMut.isPending || updateMut.isPending;

  const handleSave = () => {
    setError(null);
    const input: InsurancePolicyInput = {
      groupId,
      insuranceType,
      insurerName,
      policyNumber,
      policyStartDate: startDate,
      policyEndDate: endDate,
      notes: notes.trim() || null,
    };
    const onErr = (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      toast.error(msg);
    };
    if (policy) {
      updateMut.mutate(input, {
        onSuccess: () => {
          toast.success('Policy updated');
          onClose();
        },
        onError: onErr,
      });
    } else {
      createMut.mutate(input, {
        onSuccess: () => {
          toast.success('Policy created');
          onClose();
        },
        onError: onErr,
      });
    }
  };

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
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {pending ? 'Saving…' : policy ? 'Save changes' : 'Create policy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
