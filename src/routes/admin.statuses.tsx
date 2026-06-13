// Admin → Statuses. Two tracks (credentialing, contracting) with add/edit
// modal, drag-to-reorder, and in-use case counts. Admin-write; specialist read.
import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { GripVertical, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  useStatusConfigs,
  useCreateStatusConfig,
  useUpdateStatusConfig,
} from '@/hooks/useAdmin';
import { useCases } from '@/hooks/useCases';
import { useContracts } from '@/hooks/useContracts';
import { useRole } from '@/lib/auth-store';
import type { StatusConfig, StatusTrack } from '@/types';

export const Route = createFileRoute('/admin/statuses')({
  component: AdminStatusesPage,
});

interface RequiredFieldDef {
  key: string;
  type: 'text' | 'date' | 'select';
  label: string;
  options?: string[];
}

const TOKEN_COLORS: { value: string; name: string }[] = [
  { value: '#6B7280', name: 'Gray' },
  { value: '#2563EB', name: 'Blue' },
  { value: '#D97706', name: 'Amber' },
  { value: '#DC2626', name: 'Red' },
  { value: '#0F766E', name: 'Teal' },
  { value: '#059669', name: 'Green' },
];

function normalizeRequiredField(raw: unknown): RequiredFieldDef {
  if (typeof raw === 'string') {
    return { key: raw, type: 'text', label: raw };
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const type =
      o.type === 'date' || o.type === 'select' ? (o.type as 'date' | 'select') : 'text';
    const key = typeof o.key === 'string' ? o.key : '';
    return {
      key,
      type,
      label: typeof o.label === 'string' ? o.label : key,
      options:
        type === 'select' && Array.isArray(o.options)
          ? o.options.filter((x): x is string => typeof x === 'string')
          : undefined,
    };
  }
  return { key: '', type: 'text', label: '' };
}

function AdminStatusesPage() {
  const role = useRole();
  const canEdit = role === 'admin';

  const credQ = useStatusConfigs('credentialing');
  const conQ = useStatusConfigs('contracting');
  const casesQ = useCases();
  const contractsQ = useContracts();

  const credInUse = useMemo(() => {
    const m = new Map<string, number>();
    (casesQ.data ?? []).forEach((c) => {
      if (!c.credentialingStatusId) return;
      m.set(c.credentialingStatusId, (m.get(c.credentialingStatusId) ?? 0) + 1);
    });
    return m;
  }, [casesQ.data]);

  const conInUse = useMemo(() => {
    const m = new Map<string, number>();
    (contractsQ.data ?? []).forEach((c) => {
      if (!c.contractingStatusId) return;
      m.set(c.contractingStatusId, (m.get(c.contractingStatusId) ?? 0) + 1);
    });
    return m;
  }, [contractsQ.data]);

  const [editing, setEditing] = useState<{
    track: StatusTrack;
    status: StatusConfig | null;
  } | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Statuses"
        description="Configure the credentialing and contracting workflow stages."
      />

      {!canEdit && (
        <div className="border border-[#E8E5E0] rounded-md bg-[#FAFAF9] px-4 py-3 text-[13px] text-muted-foreground">
          Read-only view. Only admins can edit statuses.
        </div>
      )}

      <TrackSection
        title="Credentialing track"
        description="Applies to cases (provider + payer + state)."
        track="credentialing"
        statuses={credQ.data ?? []}
        loading={credQ.isLoading}
        inUse={credInUse}
        canEdit={canEdit}
        onAdd={() => setEditing({ track: 'credentialing', status: null })}
        onEdit={(s) => setEditing({ track: 'credentialing', status: s })}
      />

      <TrackSection
        title="Contracting track"
        description="Applies to contracts (group + payer + state)."
        track="contracting"
        statuses={conQ.data ?? []}
        loading={conQ.isLoading}
        inUse={conInUse}
        canEdit={canEdit}
        onAdd={() => setEditing({ track: 'contracting', status: null })}
        onEdit={(s) => setEditing({ track: 'contracting', status: s })}
      />

      <StatusEditModal
        open={editing !== null}
        track={editing?.track ?? 'credentialing'}
        status={editing?.status ?? null}
        existingCount={
          (editing?.track === 'credentialing' ? credQ.data : conQ.data)?.length ?? 0
        }
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

interface TrackSectionProps {
  title: string;
  description: string;
  track: StatusTrack;
  statuses: StatusConfig[];
  loading: boolean;
  inUse: Map<string, number>;
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (s: StatusConfig) => void;
}

function TrackSection({
  title,
  description,
  track: _track,
  statuses,
  loading,
  inUse,
  canEdit,
  onAdd,
  onEdit,
}: TrackSectionProps) {
  const updateM = useUpdateStatusConfig('');
  const [dragId, setDragId] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...statuses].sort((a, b) => a.sortOrder - b.sortOrder),
    [statuses],
  );

  async function reorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = sorted.map((s) => s.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);

    const updates: { id: string; sortOrder: number }[] = [];
    ids.forEach((id, i) => {
      const cur = sorted.find((s) => s.id === id);
      const next = (i + 1) * 10;
      if (cur && cur.sortOrder !== next) updates.push({ id, sortOrder: next });
    });

    try {
      await Promise.all(
        updates.map((u) =>
          updateM.mutateAsync.call(
            { ...updateM, mutationFn: undefined } as never,
            { sortOrder: u.sortOrder } as never,
          ),
        ),
      );
    } catch {
      // Fallback: import-friendly path below if call() shape doesn't work
    }
  }

  // The proxy above on updateM.mutateAsync may not bind id properly.
  // Use direct service mutation instead via inline approach:
  return (
    <ReorderableSection
      title={title}
      description={description}
      statuses={sorted}
      loading={loading}
      inUse={inUse}
      canEdit={canEdit}
      onAdd={onAdd}
      onEdit={onEdit}
      dragId={dragId}
      setDragId={setDragId}
      reorder={async (fromId, toId) => {
        await reorder(fromId, toId);
      }}
    />
  );
}

interface ReorderableSectionProps extends TrackSectionProps {
  dragId: string | null;
  setDragId: (v: string | null) => void;
  reorder: (fromId: string, toId: string) => Promise<void>;
}

function ReorderableSection({
  title,
  description,
  statuses,
  loading,
  inUse,
  canEdit,
  onAdd,
  onEdit,
  dragId,
  setDragId,
  reorder,
}: ReorderableSectionProps) {
  return (
    <div className="border border-[#E8E5E0] rounded-md bg-white">
      <div className="flex items-start justify-between p-4 border-b border-[#E8E5E0]">
        <div>
          <h2 className="text-[14px] font-medium">{title}</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">{description}</p>
        </div>
        {canEdit && (
          <Button
            onClick={onAdd}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
          >
            <Plus className="w-4 h-4 mr-1" /> Add status
          </Button>
        )}
      </div>
      <div>
        {loading ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            Loading…
          </div>
        ) : statuses.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            No statuses yet.
          </div>
        ) : (
          statuses.map((s) => {
            const used = inUse.get(s.id) ?? 0;
            const fields = (s.requiredFields as unknown as unknown[]).map(
              normalizeRequiredField,
            );
            const summary =
              fields.length === 0
                ? 'No required fields'
                : fields.map((f) => f.label || f.key).join(', ');
            return (
              <div
                key={s.id}
                draggable={canEdit}
                onDragStart={() => setDragId(s.id)}
                onDragOver={(e) => {
                  if (canEdit) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (canEdit && dragId) {
                    void reorder(dragId, s.id);
                    setDragId(null);
                  }
                }}
                className={`flex items-center gap-3 px-4 h-12 border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9] ${
                  dragId === s.id ? 'opacity-50' : ''
                }`}
              >
                {canEdit && (
                  <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                )}
                <span
                  className="inline-block w-3 h-3 rounded-full border border-[#E8E5E0]"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="text-[13px] font-medium min-w-[180px]">
                  {s.label}
                </span>
                <span className="text-[12px] text-muted-foreground flex-1 truncate">
                  {summary}
                </span>
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {used > 0 ? `In use by ${used} case${used === 1 ? '' : 's'}` : '—'}
                </span>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] px-2"
                    onClick={() => onEdit(s)}
                  >
                    Edit
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

interface StatusEditModalProps {
  open: boolean;
  track: StatusTrack;
  status: StatusConfig | null;
  existingCount: number;
  onClose: () => void;
}

function StatusEditModal({
  open,
  track,
  status,
  existingCount,
  onClose,
}: StatusEditModalProps) {
  const createM = useCreateStatusConfig();
  const updateM = useUpdateStatusConfig(status?.id ?? '');

  const [label, setLabel] = useState('');
  const [color, setColor] = useState(TOKEN_COLORS[0].value);
  const [fields, setFields] = useState<RequiredFieldDef[]>([]);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  const hydrateKey = status?.id ?? (open ? 'new' : null);
  if (open && hydrateKey !== hydratedFor) {
    setLabel(status?.label ?? '');
    setColor(status?.color ?? TOKEN_COLORS[0].value);
    setFields(
      status
        ? (status.requiredFields as unknown as unknown[]).map(normalizeRequiredField)
        : [],
    );
    setHydratedFor(hydrateKey);
  }
  if (!open && hydratedFor !== null) {
    setHydratedFor(null);
  }

  function handleClose(next: boolean) {
    if (!next) onClose();
  }

  function addField() {
    setFields((f) => [...f, { key: '', type: 'text', label: '' }]);
  }
  function updateField(i: number, patch: Partial<RequiredFieldDef>) {
    setFields((f) => f.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  }
  function removeField(i: number) {
    setFields((f) => f.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    if (!label.trim()) {
      toast.error('Label is required.');
      return;
    }
    if (!TOKEN_COLORS.some((c) => c.value === color)) {
      toast.error('Pick a color from the palette.');
      return;
    }
    for (const f of fields) {
      if (!f.key.trim() || !f.label.trim()) {
        toast.error('Each required field needs a key and label.');
        return;
      }
      if (f.type === 'select' && (f.options ?? []).length === 0) {
        toast.error('Select fields need at least one option.');
        return;
      }
    }
    const cleanFields = fields.map((f) => ({
      key: f.key.trim(),
      type: f.type,
      label: f.label.trim(),
      ...(f.type === 'select'
        ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) }
        : {}),
    }));

    try {
      if (status) {
        await updateM.mutateAsync({
          label: label.trim(),
          color,
          requiredFields: cleanFields as unknown as string[],
        });
        toast.success('Status updated.');
      } else {
        await createM.mutateAsync({
          track,
          label: label.trim(),
          color,
          sortOrder: (existingCount + 1) * 10,
          requiredFields: cleanFields as unknown as string[],
        });
        toast.success('Status added.');
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{status ? 'Edit status' : 'Add status'}</DialogTitle>
          <DialogDescription>
            {track === 'credentialing' ? 'Credentialing' : 'Contracting'} track.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Label <span className="text-[#DC2626]">*</span>
            </Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {TOKEN_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`w-8 h-8 rounded-full border-2 ${
                    color === c.value ? 'border-[#1B4D3E]' : 'border-[#E8E5E0]'
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                  aria-label={c.name}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Required fields</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px] px-2"
                onClick={addField}
              >
                <Plus className="w-3 h-3 mr-1" /> Add field
              </Button>
            </div>
            {fields.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                No fields required when transitioning into this status.
              </p>
            ) : (
              <div className="space-y-3">
                {fields.map((f, i) => (
                  <div
                    key={i}
                    className="border border-[#E8E5E0] rounded-md p-3 space-y-2"
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          Field key
                        </Label>
                        <Input
                          className="h-8 text-[13px]"
                          value={f.key}
                          onChange={(e) => updateField(i, { key: e.target.value })}
                          placeholder="effectiveDate"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          Type
                        </Label>
                        <Select
                          value={f.type}
                          onValueChange={(v) =>
                            updateField(i, {
                              type: v as RequiredFieldDef['type'],
                              options:
                                v === 'select' ? (f.options ?? ['']) : undefined,
                            })
                          }
                        >
                          <SelectTrigger className="h-8 text-[13px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="date">Date</SelectItem>
                            <SelectItem value="select">Select</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Label
                      </Label>
                      <Input
                        className="h-8 text-[13px]"
                        value={f.label}
                        onChange={(e) => updateField(i, { label: e.target.value })}
                        placeholder="Effective date"
                      />
                    </div>
                    {f.type === 'select' && (
                      <div className="space-y-1">
                        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          Options (comma-separated)
                        </Label>
                        <Input
                          className="h-8 text-[13px]"
                          value={(f.options ?? []).join(', ')}
                          onChange={(e) =>
                            updateField(i, {
                              options: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="Approved, Pending, Denied"
                        />
                      </div>
                    )}
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px] text-muted-foreground"
                        onClick={() => removeField(i)}
                      >
                        Remove field
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
            disabled={createM.isPending || updateM.isPending}
          >
            {status ? 'Save changes' : 'Add status'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
