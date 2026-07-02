// Facilities list grouped by provider group, plus create/edit dialog.
// Each provider group additionally shows its insurance policies inline.
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/EmptyState';
import { useProviderGroups } from '@/hooks/useLookups';
import {
  useCreateFacility,
  useFacilitiesAll,
  useUpdateFacility,
} from '@/hooks/useOrgSettings';
import { useIsAdmin } from '@/lib/permissions';
import type { FacilityInput } from '@/services/orgSettings';
import type { Facility, ProviderGroup } from '@/types';
import { InsurancePanel } from './InsurancePanel';
import { US_STATES } from './shared';

export function FacilitiesPanel() {
  const canEdit = useIsAdmin();
  const groupsQ = useProviderGroups();
  const facilitiesQ = useFacilitiesAll();
  const [modal, setModal] = useState<{
    facility: Facility | null;
    defaultGroupId: string | null;
  } | null>(null);

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
    <section className="border border-[#E8E5E0] rounded-md bg-white">
      <div className="flex items-center justify-between p-4 border-b border-[#E8E5E0]">
        <h2 className="text-[15px] font-semibold">Facilities</h2>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setModal({ facility: null, defaultGroupId: null })}
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
                      setModal({ facility: null, defaultGroupId: g.id })
                    }
                  >
                    Add to group
                  </Button>
                )}
              </div>
              {list.length === 0 ? (
                <div className="py-4">
                  <EmptyState message="No facilities yet" />
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
                              setModal({
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
                  <InsurancePanel groupId={g.id} canEdit={canEdit} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {modal ? (
        <FacilityEditModal
          facility={modal.facility}
          defaultGroupId={modal.defaultGroupId}
          groups={groupsQ.data ?? []}
          onClose={() => setModal(null)}
        />
      ) : null}
    </section>
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
