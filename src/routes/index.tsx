// Operational dashboard: KPI strip, status bar chart, overdue tasks,
// CAQH watch list, stalled cases, recent activity. Data-first layout.
import { useMemo } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { differenceInCalendarDays, format, formatDistanceToNow, parseISO } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/StatusPill';
import { useTasks } from '@/hooks/useTasks';
import { useCases } from '@/hooks/useCases';
import { useProviders } from '@/hooks/useProviders';
import { usePayers, useStatusConfigs, useAuditLog } from '@/hooks/useAdmin';
import { useCoordinators } from '@/hooks/useLookups';
import { supabase } from '@/integrations/supabase/externalClient';
import { useQuery } from '@tanstack/react-query';
import { useActiveOrgId } from '@/lib/auth-store';
import { camelizeRow } from '@/lib/case';
import type { Touch } from '@/types';

export const Route = createFileRoute('/')({
  component: DashboardPage,
});

const CARD = 'border border-[#E8E5E0] rounded-md bg-white p-4';
const TODAY = () => new Date();

function DashboardPage() {
  const navigate = useNavigate();
  const orgId = useActiveOrgId() ?? 'no-org';

  const { data: cases } = useCases();
  const { data: tasks } = useTasks();
  const { data: providers } = useProviders();
  const { data: payers } = usePayers();
  const { data: statuses } = useStatusConfigs('credentialing');
  const { data: coordinators } = useCoordinators();
  const { data: audit } = useAuditLog({ limit: 10 });

  // All touches in active org (for stalled list).
  const { data: touches } = useQuery({
    queryKey: ['dashboard-touches', orgId],
    enabled: orgId !== 'no-org',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('touches')
        .select('*')
        .eq('org_id', orgId)
        .order('touch_date', { ascending: false });
      if (error) throw error;
      return camelizeRow<Touch[]>(data ?? []);
    },
  });

  const statusById = useMemo(() => {
    const m = new Map<string, { label: string; color: string }>();
    for (const s of statuses ?? []) m.set(s.id, { label: s.label, color: s.color });
    return m;
  }, [statuses]);

  const providerById = useMemo(() => {
    const m = new Map<string, (typeof providers extends (infer T)[] | undefined ? T : never)>();
    for (const p of providers ?? []) m.set(p.id, p);
    return m;
  }, [providers]);

  const payerById = useMemo(() => {
    const m = new Map<string, { name: string }>();
    for (const p of payers ?? []) m.set(p.id, p);
    return m;
  }, [payers]);

  const caseById = useMemo(() => {
    const m = new Map<string, NonNullable<typeof cases>[number]>();
    for (const c of cases ?? []) m.set(c.id, c);
    return m;
  }, [cases]);

  const coordinatorById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of coordinators ?? []) {
      m.set(c.id, c.fullName ?? c.email ?? 'Unassigned');
    }
    return m;
  }, [coordinators]);

  // ---------- KPIs ----------
  const activeCount = (cases ?? []).filter((c) => {
    const s = c.credentialingStatusId ? statusById.get(c.credentialingStatusId) : null;
    if (!s) return false;
    const l = s.label.toLowerCase();
    return l !== 'denied' && l !== 'expired' && l !== 'terminated';
  }).length;

  const today = TODAY();
  const overdueTasks = (tasks ?? []).filter(
    (t) =>
      t.status !== 'completed' &&
      t.dueDate &&
      differenceInCalendarDays(today, parseISO(t.dueDate)) > 0,
  );

  const approvedDaysList = (cases ?? [])
    .filter((c) => c.submittedDate && c.approvedDate)
    .map((c) =>
      differenceInCalendarDays(parseISO(c.approvedDate as string), parseISO(c.submittedDate as string)),
    )
    .filter((n) => n >= 0);
  const avgDays =
    approvedDaysList.length > 0
      ? Math.round(approvedDaysList.reduce((a, b) => a + b, 0) / approvedDaysList.length)
      : 0;

  const awaitingEffectiveStatusId = useMemo(() => {
    for (const s of statuses ?? []) {
      if (s.label.toLowerCase().includes('pending effective')) return s.id;
    }
    return null;
  }, [statuses]);
  const awaitingEffective = (cases ?? []).filter(
    (c) => awaitingEffectiveStatusId && c.credentialingStatusId === awaitingEffectiveStatusId,
  ).length;

  // ---------- Bar chart data ----------
  const caseCountByStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cases ?? []) {
      if (!c.credentialingStatusId) continue;
      m.set(c.credentialingStatusId, (m.get(c.credentialingStatusId) ?? 0) + 1);
    }
    return m;
  }, [cases]);
  const maxCount = Math.max(1, ...Array.from(caseCountByStatus.values()));
  const sortedStatuses = useMemo(
    () => [...(statuses ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [statuses],
  );

  // ---------- Overdue table (top 8) ----------
  const overdueTop = overdueTasks
    .slice()
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    .slice(0, 8)
    .map((t) => {
      const c = t.caseId ? caseById.get(t.caseId) : null;
      const provider = c?.providerId ? providerById.get(c.providerId) : null;
      const payer = c?.payerId ? payerById.get(c.payerId) : null;
      const coord = c?.assignedTo ? coordinatorById.get(c.assignedTo) : null;
      return { t, provider, payer, coord };
    });

  // ---------- CAQH watch ----------
  const caqhRows = useMemo(() => {
    const rows = (providers ?? [])
      .filter((p) => p.caqhLastAttestedDate && p.status !== 'terminated')
      .map((p) => ({
        provider: p,
        days: differenceInCalendarDays(today, parseISO(p.caqhLastAttestedDate as string)),
      }))
      .filter((r) => r.days >= 60)
      .sort((a, b) => b.days - a.days)
      .slice(0, 8);
    return rows;
  }, [providers]);

  // ---------- Stalled cases ----------
  const stalledRows = useMemo(() => {
    const lastTouchByCase = new Map<string, string>();
    for (const tch of touches ?? []) {
      if (!lastTouchByCase.has(tch.caseId)) lastTouchByCase.set(tch.caseId, tch.touchDate);
    }
    const rows: { caseId: string; daysSilent: number; label: string }[] = [];
    for (const c of cases ?? []) {
      const status = c.credentialingStatusId ? statusById.get(c.credentialingStatusId) : null;
      if (!status) continue;
      const l = status.label.toLowerCase();
      if (l === 'denied' || l === 'expired' || l === 'terminated' || l === 'approved') continue;
      const last = lastTouchByCase.get(c.id) ?? c.createdAt;
      const days = differenceInCalendarDays(today, parseISO(last));
      if (days < 14) continue;
      const provider = c.providerId ? providerById.get(c.providerId) : null;
      const payer = c.payerId ? payerById.get(c.payerId) : null;
      const label = `${provider ? `${provider.firstName} ${provider.lastName}` : 'Provider'} · ${payer?.name ?? 'Payer'} · ${c.state}`;
      rows.push({ caseId: c.id, daysSilent: days, label });
    }
    return rows.sort((a, b) => b.daysSilent - a.daysSilent).slice(0, 8);
  }, [touches, cases, providerById, payerById, statusById]);

  const isLoading = !cases || !tasks || !providers || !statuses;

  return (
    <div className="flex flex-col gap-4">
      {/* KPI strip */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Active cases" value={activeCount} loading={isLoading} />
        <KpiCard
          label="Overdue tasks"
          value={overdueTasks.length}
          valueClass={overdueTasks.length > 0 ? 'text-[#DC2626]' : ''}
          onClick={() => navigate({ to: '/tasks' })}
          loading={isLoading}
        />
        <KpiCard label="Avg days to approval" value={avgDays} loading={isLoading} />
        <KpiCard
          label="Awaiting effective date"
          value={awaitingEffective}
          onClick={() => navigate({ to: '/cases' })}
          loading={isLoading}
        />
      </section>

      {/* Middle row: bar chart + recent activity */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${CARD} xl:col-span-2`}>
          <h2 className="text-[14px] font-semibold text-foreground mb-4">Cases by Status</h2>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : sortedStatuses.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No statuses configured.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {sortedStatuses.map((s) => {
                const count = caseCountByStatus.get(s.id) ?? 0;
                const pct = (count / maxCount) * 100;
                return (
                  <div
                    key={s.id}
                    className="grid grid-cols-[160px_1fr_40px] items-center gap-3 h-10"
                  >
                    <div
                      className="text-[13px] text-foreground truncate"
                      title={s.label}
                    >
                      {s.label}
                    </div>
                    <div className="h-2 rounded-full bg-[#F3F4F6] overflow-hidden">
                      {count > 0 ? (
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(pct, 3)}%`, backgroundColor: s.color }}
                        />
                      ) : null}
                    </div>
                    <div className="text-[13px] text-foreground text-right tabular-nums">
                      {count}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={CARD}>
          <h2 className="text-[14px] font-semibold text-foreground mb-4">Recent Activity</h2>
          {!audit ? (
            <Skeleton className="h-48 w-full" />
          ) : audit.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No recent activity.</p>
          ) : (
            <ul className="flex flex-col">
              {audit.slice(0, 10).map((a) => (
                <li
                  key={a.id}
                  className="flex items-start gap-3 py-2 border-b border-[#E8E5E0] last:border-b-0"
                >
                  <div className="w-16 shrink-0 text-[12px] text-muted-foreground">
                    {formatDistanceToNow(parseISO(a.ts), { addSuffix: false })}
                  </div>
                  <div className="text-[13px] text-foreground flex-1">
                    {a.description ?? a.actionType}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Bottom row: overdue + CAQH */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={CARD}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[14px] font-semibold text-foreground">Team Overdue Tasks</h2>
            {overdueTasks.length > 0 ? (
              <span className="text-[13px] text-[#DC2626] font-medium tabular-nums">
                {overdueTasks.length}
              </span>
            ) : null}
          </div>
          {overdueTop.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No overdue tasks.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-[#E8E5E0]">
                  <th className="font-medium py-2">Task</th>
                  <th className="font-medium py-2">Provider</th>
                  <th className="font-medium py-2">Payer</th>
                  <th className="font-medium py-2">Due</th>
                  <th className="font-medium py-2">Coordinator</th>
                </tr>
              </thead>
              <tbody>
                {overdueTop.map(({ t, provider, payer, coord }) => (
                  <tr
                    key={t.id}
                    onClick={() => navigate({ to: '/tasks/$id', params: { id: t.id } })}
                    className="h-10 cursor-pointer border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#F9FAFB]"
                  >
                    <td className="truncate max-w-[180px] pr-2">{t.title}</td>
                    <td className="truncate max-w-[140px] pr-2">
                      {provider ? `${provider.firstName} ${provider.lastName}` : '—'}
                    </td>
                    <td className="truncate max-w-[120px] pr-2">{payer?.name ?? '—'}</td>
                    <td className="text-[#DC2626] tabular-nums pr-2">
                      {t.dueDate ? format(parseISO(t.dueDate), 'MMM d') : '—'}
                    </td>
                    <td className="truncate max-w-[120px]">{coord ?? 'Unassigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={CARD}>
          <h2 className="text-[14px] font-semibold text-foreground mb-3">CAQH Watch List</h2>
          {caqhRows.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">All attestations current.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-[#E8E5E0]">
                  <th className="font-medium py-2">Provider</th>
                  <th className="font-medium py-2">Days since attest</th>
                  <th className="font-medium py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {caqhRows.map(({ provider, days }) => {
                  const pill =
                    days >= 110 ? (
                      <StatusPill status="red" label="Critical (>110)" />
                    ) : days >= 90 ? (
                      <StatusPill status="amber" label="Warning (>90)" />
                    ) : (
                      <StatusPill status="gray" label="Monitor" />
                    );
                  return (
                    <tr
                      key={provider.id}
                      onClick={() => navigate({ to: '/providers/$id', params: { id: provider.id } })}
                      className="h-10 cursor-pointer border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#F9FAFB]"
                    >
                      <td className="truncate max-w-[180px] pr-2">
                        {provider.firstName} {provider.lastName}
                      </td>
                      <td className="tabular-nums pr-2">{days}</td>
                      <td>{pill}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Stalled cases */}
      <section className="grid grid-cols-1 gap-4">
        <div className={CARD}>
          <h2 className="text-[14px] font-semibold text-foreground mb-3">Stalled Cases</h2>
          {stalledRows.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No stalled cases.</p>
          ) : (
            <ul className="flex flex-col">
              {stalledRows.map((r) => (
                <li
                  key={r.caseId}
                  onClick={() => navigate({ to: '/cases/$id', params: { id: r.caseId } })}
                  className="h-10 flex items-center justify-between cursor-pointer border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#F9FAFB] text-[13px]"
                >
                  <span className="truncate pr-3">{r.label}</span>
                  <span className="tabular-nums text-muted-foreground shrink-0">
                    {r.daysSilent} days silent
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  valueClass = '',
  onClick,
  loading,
}: {
  label: string;
  value: number;
  valueClass?: string;
  onClick?: () => void;
  loading?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`${CARD} ${onClick ? 'cursor-pointer hover:bg-[#F9FAFB]' : ''}`}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">
        {label}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16 mt-2" />
      ) : (
        <div className={`mt-2 text-[28px] font-semibold tabular-nums ${valueClass}`}>{value}</div>
      )}
    </div>
  );
}

// date-fns format imported lazily via inline import would break SSR; use top-level.
import { format } from 'date-fns';
