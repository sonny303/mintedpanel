// Case detail at /cases/$id. Mission control for one provider+payer+state
// case: header, MSO callout, status change modal, tasks, touch log, side cards.
import { useMemo, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { differenceInDays, format, parseISO } from 'date-fns';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Circle,
  ExternalLink,
  Globe,
  History,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Printer,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusPill, type StatusColor } from '@/components/StatusPill';
import { CopyButton } from '@/components/CopyButton';
import { useCase, useContractFor, useUpdateCaseStatus } from '@/hooks/useCases';
import { useStatusConfigs } from '@/hooks/useAdmin';
import { useCoordinators, useCreateNote, useMsoRoutingRule } from '@/hooks/useLookups';
import { useLogTouch } from '@/hooks/useTouches';
import { useRole } from '@/lib/auth-store';
import type {
  StatusConfig,
  Task,
  TouchOutcome,
  TouchType,
} from '@/types';

export const Route = createFileRoute('/cases/$id')({
  component: CaseDetailPage,
});

function hexToStatusColor(hex: string | null | undefined): StatusColor {
  switch ((hex ?? '').toUpperCase()) {
    case '#2563EB': return 'blue';
    case '#D97706': return 'amber';
    case '#DC2626':
    case '#991B1B': return 'red';
    case '#0891B2': return 'teal';
    case '#059669': return 'green';
    default: return 'gray';
  }
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  try { return format(parseISO(value), 'MMM dd, yyyy'); } catch { return value; }
}
function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try { return format(parseISO(value), 'MMM dd, yyyy h:mm a'); } catch { return value; }
}

const TOUCH_TYPE_ICON: Record<TouchType, typeof Phone> = {
  call: Phone, email: Mail, portal: Globe, fax: Printer,
};
const TOUCH_TYPE_LABEL: Record<TouchType, string> = {
  call: 'Call', email: 'Email', portal: 'Portal', fax: 'Fax',
};
const OUTCOME_OPTIONS: { value: TouchOutcome; label: string }[] = [
  { value: 'reached', label: 'Reached' },
  { value: 'left_voicemail', label: 'Left Message' },
  { value: 'no_answer', label: 'No Answer' },
  { value: 'response_received', label: 'Response Received' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'no_response', label: 'No Response' },
];
const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(
  OUTCOME_OPTIONS.map((o) => [o.value, o.label]),
);

function taskStatusIcon(status: Task['status'], locked: boolean) {
  if (locked) return <Lock className="w-4 h-4 text-muted-foreground" />;
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-[#059669]" />;
  if (status === 'in_progress') return <Circle className="w-4 h-4 text-[#D97706] fill-[#FEF3C7]" />;
  if (status === 'blocked') return <Lock className="w-4 h-4 text-muted-foreground" />;
  return <Circle className="w-4 h-4 text-muted-foreground" />;
}

function isExecutedLabel(label: string | undefined): boolean {
  return (label ?? '').toLowerCase().includes('execut');
}

function CaseDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const role = useRole();
  const canEdit = role !== 'billing';

  const caseQ = useCase(id);
  const statusesQ = useStatusConfigs();
  const coordinatorsQ = useCoordinators();
  const c = caseQ.data;
  const contractQ = useContractFor(c?.groupId ?? undefined, c?.payerId, c?.state);
  const routingRuleQ = useMsoRoutingRule(c?.payerId, c?.state, c?.specialty ?? null);

  const updateStatusM = useUpdateCaseStatus();
  const logTouchM = useLogTouch();
  const createNoteM = useCreateNote();

  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [addTouchOpen, setAddTouchOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);

  const statusById = useMemo(() => {
    const m = new Map<string, StatusConfig>();
    (statusesQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [statusesQ.data]);

  const credentialingStatuses = useMemo(
    () => (statusesQ.data ?? []).filter((s) => s.track === 'credentialing'),
    [statusesQ.data],
  );

  const coordinatorName = useMemo(() => {
    if (!c?.assignedTo) return '—';
    const found = (coordinatorsQ.data ?? []).find((x) => x.id === c.assignedTo);
    return found?.fullName ?? found?.email ?? '—';
  }, [c?.assignedTo, coordinatorsQ.data]);

  if (caseQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (caseQ.isError) {
    return (
      <div>
        <PageHeader title="Something went wrong loading this case" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => caseQ.refetch()}>Retry</Button>
          <Button variant="outline" onClick={() => navigate({ to: '/cases' })}>Back to cases</Button>
        </div>
      </div>
    );
  }
  if (!c) {
    return (
      <div>
        <PageHeader title="Case not found" />
        <Button variant="outline" onClick={() => navigate({ to: '/cases' })}>Back to cases</Button>
      </div>
    );
  }


  const providerName = c.provider
    ? `${c.provider.firstName} ${c.provider.lastName}${c.provider.credentials ? `, ${c.provider.credentials}` : ''}`
    : 'Unknown provider';

  const credStatus = c.credentialingStatusId ? statusById.get(c.credentialingStatusId) : null;
  const contract = contractQ.data ?? null;
  const contractStatus = contract?.contractingStatusId ? statusById.get(contract.contractingStatusId) : null;
  const contractIsExecuted = isExecutedLabel(contractStatus?.label);

  const tasks = (c.tasks ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const touches = (c.touches ?? []).slice().sort(
    (a, b) => parseISO(b.touchDate).getTime() - parseISO(a.touchDate).getTime(),
  );
  const statusHistory = (c.statusHistory ?? []).slice().sort(
    (a, b) => parseISO(b.changedAt).getTime() - parseISO(a.changedAt).getTime(),
  );
  const notes = (c.notes ?? []).slice().sort(
    (a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime(),
  );

  const daysOpen = c.submittedDate
    ? differenceInDays(new Date(), parseISO(c.submittedDate))
    : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold text-foreground flex items-center gap-2 flex-wrap">
              {c.provider ? (
                <Link
                  to="/providers/$id"
                  params={{ id: c.provider.id }}
                  className="hover:underline"
                >
                  {providerName}
                </Link>
              ) : providerName}
              <Badge variant="secondary" className="font-normal text-[10px] uppercase tracking-wide">
                Initial Credentialing
              </Badge>
            </h1>
            <p className="text-[14px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              {c.payer?.name ?? '—'}
              <span className="text-border">·</span>
              {c.state}
              {c.specialty ? (<><span className="text-border">·</span>{c.specialty}</>) : null}
            </p>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Credentialing
              </span>
              <div className="flex items-center gap-2">
                {credStatus ? (
                  <StatusPill status={hexToStatusColor(credStatus.color)} label={credStatus.label} />
                ) : (
                  <StatusPill status="gray" label="—" />
                )}
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => setStatusModalOpen(true)}
                  >
                    Change
                  </Button>
                )}
              </div>
            </div>
            <Separator orientation="vertical" className="h-8" />
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Group Contract
              </span>
              <div className="flex items-center gap-2">
                {contractStatus ? (
                  <StatusPill status={hexToStatusColor(contractStatus.color)} label={contractStatus.label} />
                ) : (
                  <StatusPill status="gray" label="No contract" />
                )}
                <Link
                  to="/reports"
                  search={{ tab: 'contracts' } as never}
                  className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                >
                  View contract
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* MSO callout */}
        {c.mso ? (
          <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-md p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-[#D97706]">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span className="text-[14px] font-medium">
                  Route through {c.mso.name}, not {c.payer?.name ?? 'payer'} directly
                </span>
              </div>
              {c.mso.portalUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 bg-white border-[#FDE68A] text-[#D97706] hover:bg-[#FEF3C7] hover:text-[#D97706]"
                  asChild
                >
                  <a href={c.mso.portalUrl} target="_blank" rel="noreferrer">
                    Go to Portal <ExternalLink className="w-3 h-3 ml-1.5" />
                  </a>
                </Button>
              )}
            </div>
            {routingRuleQ.data?.notes ? (
              <p className="text-[12px] text-[#92400E] mt-2 ml-8">{routingRuleQ.data.notes}</p>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* LEFT */}
          <div className="lg:col-span-3 space-y-6">
            {/* Tasks */}
            <Card className="shadow-none border-border">
              <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
                <CardTitle className="text-[14px] font-semibold">Tasks</CardTitle>
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {completedTasks} of {tasks.length} completed
                </span>
              </CardHeader>
              <CardContent className="p-0">
                {tasks.length === 0 ? (
                  <div className="p-6 text-center text-[13px] text-muted-foreground">No tasks yet</div>
                ) : (
                  <div className="divide-y divide-border">
                    {tasks.map((t, idx) => {
                      const previousIncomplete = tasks
                        .slice(0, idx)
                        .some((p) => p.status !== 'completed');
                      const locked = previousIncomplete && t.status !== 'completed';
                      const overdue =
                        t.status !== 'completed' &&
                        t.dueDate &&
                        differenceInDays(new Date(), parseISO(t.dueDate)) > 0;
                      const row = (
                        <div
                          className={`p-3 flex items-center gap-3 text-[13px] ${
                            locked ? 'opacity-60 cursor-not-allowed' : 'hover:bg-muted/30 cursor-pointer'
                          }`}
                          onClick={() => {
                            if (locked) return;
                            navigate({ to: '/tasks/$id', params: { id: t.id } });
                          }}
                        >
                          <div className="flex-shrink-0">{taskStatusIcon(t.status, locked)}</div>
                          <div
                            className={`flex-1 ${
                              t.status === 'completed'
                                ? 'text-muted-foreground line-through'
                                : 'text-foreground font-medium'
                            }`}
                          >
                            {t.title}
                          </div>
                          <span
                            className={`w-20 text-right tabular-nums text-[12px] ${
                              overdue ? 'text-[#DC2626] font-semibold' : 'text-muted-foreground'
                            }`}
                          >
                            {t.dueDate ? format(parseISO(t.dueDate), 'MMM dd') : 'TBD'}
                          </span>
                        </div>
                      );
                      return locked ? (
                        <Tooltip key={t.id}>
                          <TooltipTrigger asChild><div>{row}</div></TooltipTrigger>
                          <TooltipContent>Complete previous task first</TooltipContent>
                        </Tooltip>
                      ) : (
                        <div key={t.id}>{row}</div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Touch Log */}
            <Card className="shadow-none border-border">
              <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
                <CardTitle className="text-[14px] font-semibold">Touch Log</CardTitle>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setAddTouchOpen((v) => !v)}
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add touch
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {addTouchOpen && canEdit ? (
                  <AddTouchForm
                    onCancel={() => setAddTouchOpen(false)}
                    onSave={async (input) => {
                      try {
                        await logTouchM.mutateAsync({ caseId: c.id, input });
                        setAddTouchOpen(false);
                        toast.success('Touch logged');
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                    saving={logTouchM.isPending}
                  />
                ) : null}
                {touches.length === 0 ? (
                  <div className="p-8 flex flex-col items-center justify-center text-center">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3">
                      <MessageSquare className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <p className="text-[14px] font-medium text-foreground">No touches logged yet</p>
                    <p className="text-[12px] text-muted-foreground mt-1">
                      Record calls, emails, and portal updates here.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 space-y-6">
                    {touches.map((t, idx) => {
                      const Icon = TOUCH_TYPE_ICON[t.touchType] ?? Phone;
                      const isLatest = idx === 0;
                      const coordName =
                        (coordinatorsQ.data ?? []).find((x) => x.id === t.coordinatorId)?.fullName ??
                        (coordinatorsQ.data ?? []).find((x) => x.id === t.coordinatorId)?.email ??
                        '—';
                      return (
                        <div key={t.id} className="relative pl-6 border-l-2 border-muted pb-2">
                          <div
                            className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-background border-2 ${
                              isLatest ? 'border-primary' : 'border-muted'
                            } flex items-center justify-center`}
                          >
                            {isLatest ? <div className="w-1.5 h-1.5 rounded-full bg-primary" /> : null}
                          </div>
                          <div className="flex items-start justify-between mb-1 gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13px] font-semibold text-foreground tabular-nums">
                                {fmtDate(t.touchDate)}
                              </span>
                              <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-medium bg-background gap-1 text-muted-foreground">
                                <Icon className="w-3 h-3" /> {TOUCH_TYPE_LABEL[t.touchType]}
                              </Badge>
                              <span className="text-[13px] text-foreground font-medium">
                                · {OUTCOME_LABEL[t.outcome] ?? t.outcome}
                              </span>
                            </div>
                            <span className="text-[12px] text-muted-foreground flex items-center gap-1 shrink-0">
                              <User className="w-3 h-3" /> {coordName}
                            </span>
                          </div>
                          {t.notes ? (
                            <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-wrap">
                              {t.notes}
                            </p>
                          ) : null}
                          {t.nextFollowUpDate ? (
                            <div className="mt-2 text-[12px] text-[#D97706] inline-flex items-center gap-1 font-medium bg-[#FEF3C7] px-2 py-0.5 rounded">
                              <Calendar className="w-3 h-3" /> Next follow-up: {fmtDate(t.nextFollowUpDate)}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* RIGHT */}
          <div className="lg:col-span-2 space-y-6">
            {/* Case Facts */}
            <Card className="shadow-none border-border">
              <CardHeader className="p-4 pb-2 border-b border-border">
                <CardTitle className="text-[14px] font-semibold">Case Facts</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <dl className="space-y-3 text-[13px]">
                  <Row label="Submitted" value={<span className="tabular-nums">{fmtDate(c.submittedDate)}</span>} />
                  <Row label="Expected effective" value={<span className="tabular-nums">{fmtDate(c.expectedEffectiveDate)}</span>} />
                  <Row label="Confirmed effective" value={<span className="tabular-nums">{fmtDate(c.confirmedEffectiveDate)}</span>} />

                  <Row label="Days open" value={
                    <span className="tabular-nums">{daysOpen !== null ? `${daysOpen}d` : '—'}</span>
                  }/>
                  <Separator className="my-2" />
                  <Row label="Coordinator" value={coordinatorName} />
                  <Row label="Group" value={c.group?.name ?? '—'} />
                  <Row label="Facility" value={c.facility?.name ?? '—'} />
                </dl>
              </CardContent>
            </Card>

            {/* Key Identifiers */}
            <Card className="shadow-none border-border">
              <CardHeader className="p-4 pb-2 border-b border-border">
                <CardTitle className="text-[14px] font-semibold">Key Identifiers</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <dl className="space-y-3 text-[13px]">
                  <IdRow label="Provider NPI" value={c.provider?.npi ?? null} />
                  <IdRow label="CAQH ID" value={c.provider?.caqhId ?? null} />
                  <IdRow label="Taxonomy" value={c.provider?.taxonomyCode ?? null} />
                  <IdRow label="Group NPI" value={c.group?.npiType2 ?? null} />
                  <IdRow label="Group TIN" value={c.group?.tin ?? null} />
                </dl>
              </CardContent>
            </Card>

            {/* Status History */}
            <Card className="shadow-none border-border">
              <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
                <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
                  <History className="w-4 h-4 text-muted-foreground" /> Status History
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {statusHistory.length === 0 ? (
                  <div className="text-[13px] text-muted-foreground">No changes yet</div>
                ) : (
                  <ul className="space-y-3 text-[13px]">
                    {statusHistory.map((h) => {
                      const from = h.fromStatusId ? statusById.get(h.fromStatusId)?.label ?? '—' : '—';
                      const to = h.toStatusId ? statusById.get(h.toStatusId)?.label ?? '—' : '—';
                      return (
                        <li key={h.id} className="flex justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-foreground">
                              <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-2">
                                {h.track}
                              </span>
                              {from} → <span className="font-medium">{to}</span>
                            </div>
                          </div>
                          <div className="text-[11px] text-muted-foreground text-right shrink-0 tabular-nums">
                            {fmtDateTime(h.changedAt)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Notes */}
            <Card className="shadow-none border-border">
              <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
                <CardTitle className="text-[14px] font-semibold">Internal Notes</CardTitle>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => setAddNoteOpen((v) => !v)}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {addNoteOpen && canEdit ? (
                  <AddNoteForm
                    onCancel={() => setAddNoteOpen(false)}
                    onSave={async (content) => {
                      try {
                        await createNoteM.mutateAsync({
                          entityType: 'case',
                          entityId: c.id,
                          content,
                        });
                        setAddNoteOpen(false);
                        toast.success('Note added');
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                    saving={createNoteM.isPending}
                  />
                ) : null}
                {notes.length === 0 ? (
                  <div className="text-[13px] text-muted-foreground">No notes yet</div>
                ) : (
                  notes.map((n) => (
                    <div key={n.id} className="bg-muted/30 p-3 rounded-md border border-border">
                      <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{n.content}</p>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="font-medium inline-flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {n.authorName ?? '—'}

                        </span>
                        <span className="tabular-nums">{fmtDateTime(n.createdAt)}</span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <ChangeStatusDialog
        open={statusModalOpen}
        onOpenChange={setStatusModalOpen}
        statuses={credentialingStatuses}
        currentStatusId={c.credentialingStatusId}
        payerName={c.payer?.name ?? 'payer'}
        state={c.state}
        contractIsExecuted={contractIsExecuted}
        saving={updateStatusM.isPending}
        onSave={async ({ statusId, metadata, withoutContractWarning }) => {
          try {
            const merged: Record<string, unknown> = { ...metadata };
            if (withoutContractWarning) {
              merged.__warning = 'set Active without executed contract';
            }
            await updateStatusM.mutateAsync({
              caseId: c.id,
              statusId,
              metadata: merged,
            });
            setStatusModalOpen(false);
            toast.success('Status updated');
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </TooltipProvider>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </div>
  );
}

function IdRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className="font-medium tabular-nums">{value ?? '—'}</span>
        {value ? <CopyButton value={value} label={label} /> : null}
      </dd>
    </div>
  );
}

interface AddTouchFormProps {
  onCancel: () => void;
  onSave: (input: {
    touchDate: string;
    touchType: TouchType;
    outcome: TouchOutcome;
    notes: string | null;
    nextFollowUpDate: string | null;
  }) => void;
  saving: boolean;
}

function AddTouchForm({ onCancel, onSave, saving }: AddTouchFormProps) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [touchDate, setTouchDate] = useState(today);
  const [touchType, setTouchType] = useState<TouchType>('call');
  const [outcome, setOutcome] = useState<TouchOutcome>('reached');
  const [notes, setNotes] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');

  return (
    <div className="p-4 bg-muted/30 border-b border-border space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Date</Label>
          <Input type="date" value={touchDate} onChange={(e) => setTouchDate(e.target.value)} className="h-8 text-[13px] bg-background" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Type</Label>
          <Select value={touchType} onValueChange={(v) => setTouchType(v as TouchType)}>
            <SelectTrigger className="h-8 text-[13px] bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="call">Call</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="portal">Portal</SelectItem>
              <SelectItem value="fax">Fax</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Outcome</Label>
        <Select value={outcome} onValueChange={(v) => setOutcome(v as TouchOutcome)}>
          <SelectTrigger className="h-8 text-[13px] bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            {OUTCOME_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Notes</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Enter details about this touch..."
          className="min-h-[80px] text-[13px] bg-background resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Next follow-up</Label>
          <Input type="date" value={nextFollowUpDate} onChange={(e) => setNextFollowUpDate(e.target.value)} className="h-8 text-[13px] bg-background" />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button
          size="sm"
          disabled={saving}
          onClick={() => onSave({
            touchDate,
            touchType,
            outcome,
            notes: notes.trim() ? notes.trim() : null,
            nextFollowUpDate: nextFollowUpDate || null,
          })}
        >
          {saving ? 'Saving…' : 'Save touch'}
        </Button>
      </div>
    </div>
  );
}

function AddNoteForm({
  onCancel,
  onSave,
  saving,
}: {
  onCancel: () => void;
  onSave: (content: string) => void;
  saving: boolean;
}) {
  const [content, setContent] = useState('');
  return (
    <div className="space-y-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Add an internal note..."
        className="min-h-[80px] text-[13px] resize-none"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button
          size="sm"
          disabled={saving || !content.trim()}
          onClick={() => onSave(content.trim())}
        >
          {saving ? 'Saving…' : 'Save note'}
        </Button>
      </div>
    </div>
  );
}

interface FieldDescriptor {
  key: string;
  type?: string;
  label?: string;
  options?: string[];
}

function normalizeRequiredField(f: unknown): FieldDescriptor {
  if (typeof f === 'string') return { key: f };
  if (f && typeof f === 'object') {
    const o = f as Record<string, unknown>;
    return {
      key: typeof o.key === 'string' ? o.key : String(o.key ?? ''),
      type: typeof o.type === 'string' ? o.type : undefined,
      label: typeof o.label === 'string' ? o.label : undefined,
      options: Array.isArray(o.options)
        ? (o.options.filter((x): x is string => typeof x === 'string'))
        : undefined,
    };
  }
  return { key: '' };
}

interface ChangeStatusDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  statuses: StatusConfig[];
  currentStatusId: string | null;
  payerName: string;
  state: string;
  contractIsExecuted: boolean;
  saving: boolean;
  onSave: (args: {
    statusId: string;
    metadata: Record<string, unknown>;
    withoutContractWarning: boolean;
  }) => void;
}

function ChangeStatusDialog({
  open,
  onOpenChange,
  statuses,
  currentStatusId,
  payerName,
  state,
  contractIsExecuted,
  saving,
  onSave,
}: ChangeStatusDialogProps) {
  const [targetId, setTargetId] = useState<string>('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [warningAck, setWarningAck] = useState(false);

  const target = statuses.find((s) => s.id === targetId);
  const isActiveTarget = (target?.label ?? '').toLowerCase() === 'active';
  const needsContractWarning = isActiveTarget && !contractIsExecuted;

  const requiredFields = ((target?.requiredFields ?? []) as unknown[]).map(normalizeRequiredField);
  const missing = requiredFields.some((f) => !(fieldValues[f.key] ?? '').trim());
  const canSave = Boolean(target) && !missing && (!needsContractWarning || warningAck);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setTargetId('');
          setFieldValues({});
          setWarningAck(false);
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change credentialing status</DialogTitle>
          <DialogDescription>
            Pick the new status. Required fields must be filled before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">New status</Label>
            <Select value={targetId} onValueChange={(v) => { setTargetId(v); setFieldValues({}); setWarningAck(false); }}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id} disabled={s.id === currentStatusId}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {requiredFields.map((f) => (
            <div key={f} className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {f.replace(/_/g, ' ')}
              </Label>
              <Input
                type={/date|effective/i.test(f) ? 'date' : 'text'}
                value={fieldValues[f] ?? ''}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [f]: e.target.value }))}
                className="h-9"
              />
            </div>
          ))}

          {needsContractWarning ? (
            <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-md p-3 space-y-2">
              <div className="flex items-start gap-2 text-[#92400E]">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p className="text-[13px] font-medium">
                  No executed contract for {payerName} in {state}. Claims will deny until the
                  contract is executed. Continue?
                </p>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-[#92400E] cursor-pointer">
                <input
                  type="checkbox"
                  checked={warningAck}
                  onChange={(e) => setWarningAck(e.target.checked)}
                  className="rounded border-[#FDE68A]"
                />
                I understand and want to proceed.
              </label>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={!canSave || saving}
            onClick={() => {
              if (!target) return;
              const metadata: Record<string, unknown> = {};
              requiredFields.forEach((f) => { metadata[f] = fieldValues[f]; });
              onSave({
                statusId: target.id,
                metadata,
                withoutContractWarning: needsContractWarning,
              });
            }}
          >
            {saving ? 'Saving…' : 'Save status'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
