// SOP template editor: edit template metadata, ordered task cards with
// reorderable SOP steps and closed token data fields, plus live preview.
import { createFileRoute, useBlocker, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Copy, GripVertical, Plus, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/externalClient';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useCreateTemplate,
  usePayers,
  useTemplate,
  useUpdateTemplate,
} from '@/hooks/useAdmin';
import { useProviderGroups } from '@/hooks/useLookups';
import { useRole } from '@/lib/auth-store';
import type { SOPTaskDefinition, SOPTemplate } from '@/types';

type EditableTemplate = SOPTemplate & { archived?: boolean; isArchived?: boolean };

interface DataField {
  label: string;
  token: string;
}

interface EditableStep {
  id: string;
  label: string;
  detail: string;
  dataFields: DataField[];
}

interface EditableTask {
  id: string;
  title: string;
  description: string;
  dueOffsetDays: number;
  steps: EditableStep[];
}

interface SopFieldToken {
  token: string;
  table: string;
  column: string;
}

const TOKEN_GROUP_LABELS: Record<string, string> = {
  provider: 'Provider',
  group: 'Group',
  facility: 'Facility',
  mso: 'MSO',
  group_insurance: 'Group Insurance',
};

const TOKEN_GROUP_ORDER = ['provider', 'group', 'facility', 'mso', 'group_insurance'];

function useSopFieldTokens() {
  return useQuery({
    queryKey: ['sop-field-tokens'] as const,
    queryFn: async (): Promise<SopFieldToken[]> => {
      const { data, error } = await supabase.rpc('get_sop_field_tokens' as never);
      if (error) throw error;
      return (data ?? []) as SopFieldToken[];
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  'WI','WY',
];

const SAMPLE_VALUES: Record<string, string> = {
  'provider.npi': '1234567890',
  'provider.caqhId': 'CAQH-987654',
  'provider.taxonomyCode': '225100000X',
  'provider.firstName': 'Jordan',
  'provider.lastName': 'Rivera',
  'provider.email': 'jordan.rivera@example.com',
  'provider.licenseNumber': 'TX-PT-44821',
  'group.tin': '12-3456789',
  'group.npiType2': '9876543210',
  'group.name': 'BEST Physical Therapy',
  'facility.name': 'Riverbend Clinic — North',
  'facility.address': '4400 N Lamar Blvd, Austin, TX 78756',
  'mso.portalUrl': 'https://portal.example-mso.com',
};

function randId(): string {
  return Math.random().toString(36).slice(2, 11);
}

function toEditable(defs: SOPTaskDefinition[] | null | undefined): EditableTask[] {
  return (defs ?? []).map((d, i) => ({
    id: randId(),
    title: d.title ?? '',
    description: d.description ?? '',
    dueOffsetDays: d.dueOffsetDays ?? i * 7,
    steps: (d.steps ?? []).map((s) => {
      const raw = s as { label?: string; detail?: string; dataFields?: DataField[] };
      return {
        id: randId(),
        label: raw.label ?? '',
        detail: raw.detail ?? '',
        dataFields: (raw.dataFields ?? []).filter((f) =>
          typeof f.token === 'string' && f.token.includes('.'),
        ),
      };
    }),
  }));
}

function fromEditable(tasks: EditableTask[]): SOPTaskDefinition[] {
  return tasks.map((t, i) => ({
    title: t.title,
    description: t.description,
    sortOrder: i,
    dueOffsetDays: t.dueOffsetDays,
    steps: t.steps.map((s) => ({
      label: s.label,
      detail: s.detail,
      dataFields: s.dataFields.filter((f) =>
        typeof f.token === 'string' && f.token.includes('.'),
      ),
    })) as SOPTaskDefinition['steps'],
  }));
}

export const Route = createFileRoute('/admin/templates/$id')({
  component: TemplateEditor,
});

function TemplateEditor() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const role = useRole();
  const canEdit = role === 'admin';
  const tplQ = useTemplate(id);
  const payersQ = usePayers();
  const groupsQ = useProviderGroups();
  const updateMut = useUpdateTemplate(id);
  const createMut = useCreateTemplate();
  const tokensQ = useSopFieldTokens();
  const tokens = tokensQ.data ?? [];
  const groupedTokens = useMemo(() => {
    const map = new Map<string, SopFieldToken[]>();
    for (const t of tokens) {
      const prefix = t.token.split('.')[0];
      const arr = map.get(prefix) ?? [];
      arr.push(t);
      map.set(prefix, arr);
    }
    return TOKEN_GROUP_ORDER.filter((p) => map.has(p)).map((p) => ({
      prefix: p,
      label: TOKEN_GROUP_LABELS[p] ?? p,
      items: map.get(p) ?? [],
    }));
  }, [tokens]);
  const firstToken = tokens[0]?.token ?? 'provider.npi';

  const tpl = tplQ.data as EditableTemplate | undefined;

  const [name, setName] = useState('');
  const [payerId, setPayerId] = useState<string>('none');
  const [state, setState] = useState<string>('none');
  const [specialty, setSpecialty] = useState<string>('');
  const [groupId, setGroupId] = useState<string>('none');
  const [tasks, setTasks] = useState<EditableTask[]>([]);
  const [isArchived, setIsArchived] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragStep, setDragStep] = useState<{ taskId: string; stepId: string } | null>(null);

  useEffect(() => {
    if (!tpl) return;
    setName(tpl.name);
    setPayerId(tpl.payerId ?? 'none');
    setState(tpl.state ?? 'none');
    setSpecialty(tpl.specialty ?? '');
    setGroupId(tpl.groupId ?? 'none');
    setTasks(toEditable(tpl.taskDefinitions));
    setIsArchived(Boolean(tpl.archived ?? tpl.isArchived ?? false));
    setDirty(false);
  }, [tpl]);

  useBlocker({
    shouldBlockFn: () => {
      if (!dirty) return false;
      return !window.confirm('Discard unsaved changes?');
    },
  });

  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  function mark<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  function addTask() {
    setTasks((prev) => [
      ...prev,
      {
        id: randId(),
        title: 'New task',
        description: '',
        dueOffsetDays: prev.length * 7,
        steps: [],
      },
    ]);
    setDirty(true);
  }

  function removeTask(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setDirty(true);
  }

  function updateTask(taskId: string, patch: Partial<EditableTask>) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
    setDirty(true);
  }

  function reorderTasks(fromId: string, toId: string) {
    if (fromId === toId) return;
    setTasks((prev) => {
      const next = [...prev];
      const fromIdx = next.findIndex((t) => t.id === fromId);
      const toIdx = next.findIndex((t) => t.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    setDirty(true);
  }

  function addStep(taskId: string) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: [
                ...t.steps,
                { id: randId(), label: 'New step', detail: '', dataFields: [] },
              ],
            }
          : t,
      ),
    );
    setDirty(true);
  }

  function removeStep(taskId: string, stepId: string) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, steps: t.steps.filter((s) => s.id !== stepId) } : t,
      ),
    );
    setDirty(true);
  }

  function updateStep(taskId: string, stepId: string, patch: Partial<EditableStep>) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: t.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
            }
          : t,
      ),
    );
    setDirty(true);
  }

  function reorderSteps(taskId: string, fromId: string, toId: string) {
    if (fromId === toId) return;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const next = [...t.steps];
        const fi = next.findIndex((s) => s.id === fromId);
        const ti = next.findIndex((s) => s.id === toId);
        if (fi < 0 || ti < 0) return t;
        const [moved] = next.splice(fi, 1);
        next.splice(ti, 0, moved);
        return { ...t, steps: next };
      }),
    );
    setDirty(true);
  }

  function addDataField(taskId: string, stepId: string) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: t.steps.map((s) =>
                s.id === stepId
                  ? {
                      ...s,
                      dataFields: [
                        ...s.dataFields,
                        { label: '', token: ALLOWED_TOKENS[0] },
                      ],
                    }
                  : s,
              ),
            }
          : t,
      ),
    );
    setDirty(true);
  }

  function updateDataField(
    taskId: string,
    stepId: string,
    idx: number,
    patch: Partial<DataField>,
  ) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: t.steps.map((s) =>
                s.id === stepId
                  ? {
                      ...s,
                      dataFields: s.dataFields.map((f, i) =>
                        i === idx ? { ...f, ...patch } : f,
                      ),
                    }
                  : s,
              ),
            }
          : t,
      ),
    );
    setDirty(true);
  }

  function removeDataField(taskId: string, stepId: string, idx: number) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: t.steps.map((s) =>
                s.id === stepId
                  ? { ...s, dataFields: s.dataFields.filter((_, i) => i !== idx) }
                  : s,
              ),
            }
          : t,
      ),
    );
    setDirty(true);
  }

  async function handleSave() {
    if (!canEdit) return;
    try {
      await updateMut.mutateAsync({
        name,
        payerId: payerId === 'none' ? null : payerId,
        state: state === 'none' ? null : state,
        specialty: specialty.trim() || null,
        groupId: groupId === 'none' ? null : groupId,
        taskDefinitions: fromEditable(tasks),
        archived: isArchived,
      });
      setDirty(false);
      toast.success('Template saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(msg);
    }
  }

  async function handleDuplicate() {
    if (!canEdit) return;
    try {
      const created = await createMut.mutateAsync({
        name: `${name} (copy)`,
        payerId: payerId === 'none' ? null : payerId,
        state: state === 'none' ? null : state,
        specialty: specialty.trim() || null,
        groupId: groupId === 'none' ? null : groupId,
        taskDefinitions: fromEditable(tasks),
        archived: false,
      });
      toast.success('Template duplicated');
      navigate({ to: '/admin/templates/$id', params: { id: created.id } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Duplicate failed';
      toast.error(msg);
    }
  }

  async function handleToggleArchive() {
    if (!canEdit) return;
    const next = !isArchived;
    setIsArchived(next);
    try {
      await updateMut.mutateAsync({ archived: next });
      toast.success(next ? 'Template archived' : 'Template restored');
    } catch (err) {
      setIsArchived(!next);
      const msg = err instanceof Error ? err.message : 'Update failed';
      toast.error(msg);
    }
  }

  const previewTasks = useMemo(() => fromEditable(tasks), [tasks]);

  if (tplQ.isLoading) {
    return (
      <div className="p-6">
        <PageHeader title="Template" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!tpl) {
    return (
      <div className="p-6">
        <PageHeader title="Template not found" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title={name || 'Untitled template'}
        description={
          isArchived ? 'Archived. Hidden from case creation matching.' : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/admin/templates' })}>
              Back
            </Button>
            {canEdit ? (
              <>
                <Button variant="outline" onClick={handleDuplicate}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                </Button>
                <Button variant="outline" onClick={handleToggleArchive}>
                  {isArchived ? (
                    <>
                      <ArchiveRestore className="h-4 w-4 mr-2" />
                      Restore
                    </>
                  ) : (
                    <>
                      <Archive className="h-4 w-4 mr-2" />
                      Archive
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!dirty || updateMut.isPending}
                  style={{ backgroundColor: '#1B4D3E' }}
                  className="text-white hover:opacity-90"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updateMut.isPending ? 'Saving…' : 'Save'}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      {!canEdit ? (
        <div className="mb-4 rounded-md border border-[#E8E5E0] bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Read-only view. Only admins can edit templates.
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-4">
          <section className="rounded-md border border-[#E8E5E0] p-4">
            <h2 className="text-sm font-semibold mb-3">Template details</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => mark(setName)(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div>
                <Label>Payer</Label>
                <Select value={payerId} onValueChange={mark(setPayerId)} disabled={!canEdit}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any payer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any payer</SelectItem>
                    {(payersQ.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>State</Label>
                <Select value={state} onValueChange={mark(setState)} disabled={!canEdit}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any state" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any state</SelectItem>
                    {US_STATES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Specialty</Label>
                <Input
                  value={specialty}
                  onChange={(e) => mark(setSpecialty)(e.target.value)}
                  disabled={!canEdit}
                  placeholder="e.g. PT"
                />
              </div>
              <div>
                <Label>Group</Label>
                <Select value={groupId} onValueChange={mark(setGroupId)} disabled={!canEdit}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any group</SelectItem>
                    {(groupsQ.data ?? []).map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Task definitions</h2>
              {canEdit ? (
                <Button size="sm" variant="outline" onClick={addTask}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add task
                </Button>
              ) : null}
            </div>

            {tasks.length === 0 ? (
              <div className="rounded-md border border-dashed border-[#E8E5E0] p-6 text-center text-sm text-muted-foreground">
                No tasks defined. Add a task to start building this template.
              </div>
            ) : null}

            {tasks.map((task, taskIdx) => (
              <div
                key={task.id}
                draggable={canEdit}
                onDragStart={() => setDragTaskId(task.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragTaskId) reorderTasks(dragTaskId, task.id);
                  setDragTaskId(null);
                }}
                className="rounded-md border border-[#E8E5E0] bg-card"
              >
                <div className="flex items-start gap-2 p-4 border-b border-[#E8E5E0]">
                  {canEdit ? (
                    <GripVertical className="h-4 w-4 text-muted-foreground mt-2 cursor-grab" />
                  ) : null}
                  <div className="flex-1 grid grid-cols-[1fr_140px] gap-3">
                    <div>
                      <Label>Task {taskIdx + 1} title</Label>
                      <Input
                        value={task.title}
                        onChange={(e) => updateTask(task.id, { title: e.target.value })}
                        disabled={!canEdit}
                      />
                    </div>
                    <div>
                      <Label>Due day offset</Label>
                      <Input
                        type="number"
                        value={task.dueOffsetDays}
                        onChange={(e) =>
                          updateTask(task.id, {
                            dueOffsetDays: Number.parseInt(e.target.value, 10) || 0,
                          })
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label>Description</Label>
                      <Textarea
                        value={task.description}
                        onChange={(e) =>
                          updateTask(task.id, { description: e.target.value })
                        }
                        disabled={!canEdit}
                        rows={2}
                      />
                    </div>
                  </div>
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTask(task.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>

                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      SOP steps
                    </span>
                    {canEdit ? (
                      <Button size="sm" variant="outline" onClick={() => addStep(task.id)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add step
                      </Button>
                    ) : null}
                  </div>

                  {task.steps.map((step, stepIdx) => (
                    <div
                      key={step.id}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        setDragStep({ taskId: task.id, stepId: step.id });
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.stopPropagation();
                        if (dragStep && dragStep.taskId === task.id) {
                          reorderSteps(task.id, dragStep.stepId, step.id);
                        }
                        setDragStep(null);
                      }}
                      className="rounded-md border border-[#E8E5E0] p-3 bg-muted/20"
                    >
                      <div className="flex items-start gap-2">
                        {canEdit ? (
                          <GripVertical className="h-4 w-4 text-muted-foreground mt-2 cursor-grab" />
                        ) : null}
                        <div className="flex-1 space-y-2">
                          <div>
                            <Label className="text-xs">Step {stepIdx + 1} instruction</Label>
                            <Textarea
                              value={step.label}
                              onChange={(e) =>
                                updateStep(task.id, step.id, { label: e.target.value })
                              }
                              disabled={!canEdit}
                              rows={2}
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <Label className="text-xs">Data fields</Label>
                              {canEdit ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => addDataField(task.id, step.id)}
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Add field
                                </Button>
                              ) : null}
                            </div>
                            {step.dataFields.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No data fields.</p>
                            ) : (
                              <div className="space-y-2">
                                {step.dataFields.map((field, i) => (
                                  <div
                                    key={i}
                                    className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center"
                                  >
                                    <Input
                                      placeholder="Label"
                                      value={field.label}
                                      onChange={(e) =>
                                        updateDataField(task.id, step.id, i, {
                                          label: e.target.value,
                                        })
                                      }
                                      disabled={!canEdit}
                                    />
                                    <Select
                                      value={field.token}
                                      onValueChange={(v) =>
                                        updateDataField(task.id, step.id, i, { token: v })
                                      }
                                      disabled={!canEdit}
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {ALLOWED_TOKENS.map((tk) => (
                                          <SelectItem key={tk} value={tk}>
                                            {tk}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {canEdit ? (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => removeDataField(task.id, step.id, i)}
                                        className="text-muted-foreground hover:text-destructive"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeStep(task.id, step.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </div>

        <aside className="lg:sticky lg:top-6 self-start">
          <div className="rounded-md border border-[#E8E5E0] bg-card">
            <div className="px-4 h-10 flex items-center border-b border-[#E8E5E0]">
              <h2 className="text-sm font-semibold">Live preview</h2>
            </div>
            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {previewTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Add tasks to see how this template renders.
                </p>
              ) : (
                previewTasks.map((t, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{t.title || 'Untitled task'}</p>
                      <span className="text-xs text-muted-foreground">
                        Day +{t.dueOffsetDays ?? 0}
                      </span>
                    </div>
                    {t.description ? (
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                    ) : null}
                    <ol className="space-y-2 mt-2">
                      {(t.steps ?? []).map((s, j) => {
                        const fields =
                          (s as { dataFields?: DataField[] }).dataFields ?? [];
                        return (
                          <li
                            key={j}
                            className="rounded-md border border-[#E8E5E0] p-2 text-xs"
                          >
                            <p className="text-foreground">{s.label || `Step ${j + 1}`}</p>
                            {fields.length > 0 ? (
                              <div className="mt-2 space-y-1">
                                {fields.map((f, k) => (
                                  <div
                                    key={k}
                                    className="flex items-center justify-between gap-2"
                                  >
                                    <span className="text-muted-foreground">
                                      {f.label || f.token}
                                    </span>
                                    <span className="inline-flex items-center rounded-full border border-[#E8E5E0] bg-muted/40 px-2 py-0.5 font-mono text-[11px]">
                                      {`{{${f.token}}}`}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ))
              )}
            </div>
            <div className="px-4 py-3 border-t border-[#E8E5E0] text-xs text-muted-foreground">
              Sample value example —{' '}
              <span className="font-mono">{SAMPLE_VALUES['provider.firstName']}</span>{' '}
              <span className="font-mono">{SAMPLE_VALUES['provider.lastName']}</span>,
              NPI <span className="font-mono">{SAMPLE_VALUES['provider.npi']}</span>.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
