// Case detail at /cases/$id. Header with credentialing/contracting tracks,
// MSO routing callout, tasks + touch log, case facts, key identifiers, notes.
import { useMemo } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { differenceInDays, format, parseISO } from 'date-fns';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Circle,
  ExternalLink,
  Fax,
  Globe,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusPill, type StatusColor } from '@/components/StatusPill';
import { CopyButton } from '@/components/CopyButton';
import { useCase, useContractFor } from '@/hooks/useCases';
import { useStatusConfigs } from '@/hooks/useAdmin';
import { useCoordinators } from '@/hooks/useLookups';
import { useRole } from '@/lib/auth-store';
import type { Task, TouchType } from '@/types';

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
  call: Phone,
  email: Mail,
  portal: Globe,
  fax: Fax,
};

const TOUCH_TYPE_LABEL: Record<TouchType, string> = {
  call: 'Call',
  email: 'Email',
  portal: 'Portal',
  fax: 'Fax',
};

const OUTCOME_LABEL: Record<string, string> = {
  reached: 'Reached',
  left_voicemail: 'Left Message',
  no_answer: 'No Answer',
  response_received: 'Response Received',
  submitted: 'Submitted',
  no_response: 'No Response',
};

function taskStatusIcon(status: Task['status']) {
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-[#059669]" />;
  if (status === 'in_progress') return <Circle className="w-4 h-4 text-[#D97706]" />;
  if (status === 'blocked') return <Lock className="w-4 h-4 text-muted-foreground" />;
  return <Circle className="w-4 h-4 text-muted-foreground" />;
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

  const statusById = useMemo(() => {
    const m = new Map<string, { label: string; color: string }>();
    (statusesQ.data ?? []).forEach((s) => m.set(s.id, { label: s.label, color: s.color }));
    return m;
  }, [statusesQ.data]);

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

  if (caseQ.isError || !c) {
    return (
      <div>
        <PageHeader title="Case not found" />
        <Button variant="outline" onClick={() => navigate({ to: '/cases' })}>
          Back to cases
        </Button>
      </div>
    );
  }

  const providerName = c.provider
    ? `${c.provider.firstName} ${c.provider.lastName}${c.provider.credentials ? `, ${c.provider.credentials}` : ''}`
    : 'Unknown provider';

  const credStatus = c.credentialingStatusId
    ? statusById.get(c.credentialingStatusId)
    : null;
  const contractStatus = contractQ.data?.contractingStatusId
    ? statusById.get(contractQ.data.contractingStatusId)
    : null;

  const tasks = c.tasks ?? [];
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const touches = (c.touches ?? []).slice().sort(
    (a, b) => parseISO(b.touchDate).getTime() - parseISO(a.touchDate).getTime(),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground flex items-center gap-2">
            {providerName}
            <Badge variant="secondary" className="font-normal text-[10px] uppercase tracking-wide">
              Initial Credentialing
            </Badge>
          </h1>
          <p className="text-[14px] text-muted-foreground mt-1 flex items-center gap-2">
            {c.payer?.name ?? '—'}
            <span className="text-border">•</span>
            {c.state}
            {c.specialty ? <><span className="text-border">•</span>{c.specialty}</> : null}
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
                <Button variant="outline" size="sm" disabled className="h-6 text-[11px] px-2">
                  Change
                </Button>
              )}
            </div>
          </div>
          <Separator orientation="vertical" className="h-8" />
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              Contracting
            </span>
            <div className="flex items-center gap-2">
              {contractStatus ? (
                <StatusPill status={hexToStatusColor(contractStatus.color)} label={contractStatus.label} />
              ) : (
                <StatusPill status="gray" label="Not Started" />
              )}
              {canEdit && (
                <Button variant="outline" size="sm" disabled className="h-6 text-[11px] px-2">
                  Change
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* MSO Callout */}
      {c.mso ? (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-md p-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-[#D97706]">
            <AlertTriangle className="w-5 h-5" />
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
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left */}
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
                <div className="p-6 text-center text-[13px] text-muted-foreground">
                  No tasks yet
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {tasks
                    .slice()
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((t) => {
                      const overdue =
                        t.status !== 'completed' &&
                        t.dueDate &&
                        differenceInDays(new Date(), parseISO(t.dueDate)) > 0;
                      return (
                        <div
                          key={t.id}
                          onClick={() => navigate({ to: '/tasks/$id', params: { id: t.id } })}
                          className="p-3 flex items-center gap-3 text-[13px] hover:bg-muted/30 cursor-pointer"
                        >
                          <div className="flex-shrink-0">{taskStatusIcon(t.status)}</div>
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
                    })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Touch Log */}
          <Card className="shadow-none border-border">
            <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-[14px] font-semibold">Touch Log</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
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
                    return (
                      <div key={t.id} className="relative pl-6 border-l-2 border-muted pb-2">
                        <div
                          className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-background border-2 ${
                            isLatest ? 'border-primary' : 'border-muted'
                          } flex items-center justify-center`}
                        >
                          {isLatest ? (
                            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                          ) : null}
                        </div>
                        <div className="flex items-start justify-between mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-semibold text-foreground tabular-nums">
                              {fmtDate(t.touchDate)}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] h-5 px-1.5 font-medium bg-background gap-1 text-muted-foreground"
                            >
                              <Icon className="w-3 h-3" /> {TOUCH_TYPE_LABEL[t.touchType]}
                            </Badge>
                            <span className="text-[13px] text-foreground font-medium">
                              • {OUTCOME_LABEL[t.outcome] ?? t.outcome}
                            </span>
                          </div>
                        </div>
                        {t.notes ? (
                          <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
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

        {/* Right */}
        <div className="lg:col-span-2 space-y-6">
          {/* Case Facts */}
          <Card className="shadow-none border-border">
            <CardHeader className="p-4 pb-2 border-b border-border">
              <CardTitle className="text-[14px] font-semibold">Case Facts</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <dl className="space-y-3 text-[13px]">
                <Row label="Submitted Date" value={<span className="tabular-nums">{fmtDate(c.submittedDate)}</span>} />
                <Row label="Expected Effective" value={<span className="tabular-nums">{fmtDate(c.expectedEffectiveDate)}</span>} />
                <Row
                  label="Confirmed Effective"
                  value={
                    c.confirmedEffectiveDate ? (
                      <span className="tabular-nums">{fmtDate(c.confirmedEffectiveDate)}</span>
                    ) : (
                      <span className="text-muted-foreground italic">Pending</span>
                    )
                  }
                />
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

          {/* Internal Notes */}
          <Card className="shadow-none border-border">
            <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-[14px] font-semibold">Internal Notes</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {(c.notes ?? []).length === 0 ? (
                <div className="text-[13px] text-muted-foreground">No notes yet</div>
              ) : (
                <div className="space-y-3">
                  {c.notes.map((n) => (
                    <div key={n.id} className="bg-muted/30 p-3 rounded-md border border-border">
                      <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
                        {n.content}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="font-medium inline-flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {n.authorId ?? 'Unknown'}
                        </span>
                        <span className="tabular-nums">{fmtDateTime(n.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
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
