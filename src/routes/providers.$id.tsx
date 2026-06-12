// Provider detail at /providers/$id. Shows the provider header, cases table
// on the left, and identity/licenses/employment/CAQH cards on the right.
import React, { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { differenceInDays, format, parseISO } from 'date-fns';
import { Pencil, Plus, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, type StatusColor } from '@/components/StatusPill';
import { CopyButton } from '@/components/CopyButton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useProvider, useTerminateProvider } from '@/hooks/useProviders';
import { useCases } from '@/hooks/useCases';
import { useContracts } from '@/hooks/useContracts';
import { usePayers, useMsos, useStatusConfigs } from '@/hooks/useAdmin';
import { useProviderGroups, useStateLicensesByProvider } from '@/hooks/useLookups';
import { useRole } from '@/lib/auth-store';
import { NewCaseModal } from '@/components/cases/NewCaseModal';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

import type {
  Contract,
  CredentialCase,
  Mso,
  Payer,
  Provider,
  ProviderGroup,
  ProviderStatus,
  StatusConfig,
} from '@/types';

export const Route = createFileRoute('/providers/$id')({
  component: ProviderDetailPage,
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

const PROVIDER_STATUS_LABEL: Record<ProviderStatus, string> = {
  onboarding: 'Onboarding',
  active: 'Active',
  terminated: 'Terminated',
};

const PROVIDER_STATUS_COLOR: Record<ProviderStatus, StatusColor> = {
  onboarding: 'amber',
  active: 'green',
  terminated: 'gray',
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'MMM d, yyyy');
  } catch {
    return value;
  }
}

function ProviderDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const role = useRole();
  const canEdit = role !== 'billing';
  const [newCaseOpen, setNewCaseOpen] = useState(false);

  const providerQ = useProvider(id);
  const casesQ = useCases({ providerId: id });
  const contractsQ = useContracts();
  const payersQ = usePayers();
  const msosQ = useMsos();
  const statusesQ = useStatusConfigs();
  const groupsQ = useProviderGroups();
  const licensesQ = useStateLicensesByProvider(id);

  const payerById = useMemo(() => {
    const m = new Map<string, Payer>();
    (payersQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [payersQ.data]);

  const msoById = useMemo(() => {
    const m = new Map<string, Mso>();
    (msosQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [msosQ.data]);

  const statusById = useMemo(() => {
    const m = new Map<string, StatusConfig>();
    (statusesQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [statusesQ.data]);

  const groupById = useMemo(() => {
    const m = new Map<string, ProviderGroup>();
    (groupsQ.data ?? []).forEach((g) => m.set(g.id, g));
    return m;
  }, [groupsQ.data]);

  const contractKey = (groupId: string | null, payerId: string, state: string) =>
    `${groupId ?? ''}|${payerId}|${state}`;

  const contractByKey = useMemo(() => {
    const m = new Map<string, Contract>();
    (contractsQ.data ?? []).forEach((c) => {
      if (!c.payerId) return;
      m.set(contractKey(c.groupId, c.payerId, c.state), c);
    });
    return m;
  }, [contractsQ.data]);

  if (providerQ.isLoading) {
    return (
      <div>
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (providerQ.isError || !providerQ.data) {
    return (
      <div>
        <PageHeader title="Provider not found" />
        <Button variant="outline" onClick={() => navigate({ to: '/providers' })}>
          Back to providers
        </Button>
      </div>
    );
  }

  const provider = providerQ.data;
  const group = provider.groupId ? groupById.get(provider.groupId) ?? null : null;
  const cases = casesQ.data ?? [];

  return (
    <TooltipProvider delayDuration={200}>
      <Header
        provider={provider}
        group={group}
        canEdit={canEdit}
        onNewCase={() => setNewCaseOpen(true)}
      />
      <NewCaseModal
        open={newCaseOpen}
        onOpenChange={setNewCaseOpen}
        provider={provider}
        group={group}
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-6">
        <div className="lg:col-span-3">
          <CasesPanel
            cases={cases}
            loading={casesQ.isLoading}
            payerById={payerById}
            msoById={msoById}
            statusById={statusById}
            contractByKey={contractByKey}
            contractKey={contractKey}
            onOpenCase={(caseId) => navigate({ to: '/cases/$id', params: { id: caseId } })}
          />
        </div>

        <div className="lg:col-span-2 space-y-4">
          <IdentityCard provider={provider} />
          <LicensesCard licenses={licensesQ.data ?? []} loading={licensesQ.isLoading} />
          <EmploymentCard provider={provider} />
          <CaqhCard provider={provider} />
        </div>
      </div>
    </TooltipProvider>
  );
}

interface HeaderProps {
  provider: Provider;
  group: ProviderGroup | null;
  canEdit: boolean;
  onNewCase: () => void;
}

function Header({ provider, group, canEdit, onNewCase }: HeaderProps) {
  const name = `${provider.firstName} ${provider.lastName}${
    provider.credentials ? `, ${provider.credentials}` : ''
  }`;

  return (
    <div className="pb-4 mb-2 border-b border-border">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
              {name}
            </h1>
            <StatusPill
              status={PROVIDER_STATUS_COLOR[provider.status]}
              label={PROVIDER_STATUS_LABEL[provider.status]}
            />
            {group ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border border-border bg-muted text-foreground">
                {group.name}
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex items-center gap-4 flex-wrap text-[13px]">
            <IdField label="NPI" value={provider.npi} />
            <span className="text-border">·</span>
            <IdField label="CAQH" value={provider.caqhId} />
            <span className="text-border">·</span>
            <IdField label="Taxonomy" value={provider.taxonomyCode} />
          </div>
        </div>

        {canEdit ? (
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button variant="outline" size="sm" disabled className="gap-2">
                    <Pencil className="h-4 w-4" />
                    Edit provider
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Coming in a later step</TooltipContent>
            </Tooltip>
            <Button size="sm" className="gap-2" onClick={onNewCase}>
              <Plus className="h-4 w-4" />
              New case
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button variant="outline" size="sm" disabled className="gap-2">
                    <XCircle className="h-4 w-4" />
                    Terminate provider
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Coming in a later step</TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function IdField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-foreground tabular-nums">{value ?? '—'}</span>
      {value ? <CopyButton value={value} label={label} /> : null}
    </div>
  );
}

interface CasesPanelProps {
  cases: CredentialCase[];
  loading: boolean;
  payerById: Map<string, Payer>;
  msoById: Map<string, Mso>;
  statusById: Map<string, StatusConfig>;
  contractByKey: Map<string, Contract>;
  contractKey: (groupId: string | null, payerId: string, state: string) => string;
  onOpenCase: (id: string) => void;
}

function CasesPanel({
  cases,
  loading,
  payerById,
  msoById,
  statusById,
  contractByKey,
  contractKey,
  onOpenCase,
}: CasesPanelProps) {
  return (
    <section>
      <SectionTitle>Cases</SectionTitle>
      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <Th>Payer</Th>
              <Th>State</Th>
              <Th>Credentialing</Th>
              <Th>Group Contract</Th>
              <Th>Submitted</Th>
              <Th className="text-right">Days open</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-border h-10">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-3">
                      <Skeleton className="h-4 w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-[13px] text-muted-foreground">
                  No cases yet
                </td>
              </tr>
            ) : (
              cases.map((c) => {
                const payer = payerById.get(c.payerId);
                const credSc = c.credentialingStatusId
                  ? statusById.get(c.credentialingStatusId)
                  : null;
                const contract = contractByKey.get(
                  contractKey(c.groupId, c.payerId, c.state),
                );
                const contractSc = contract?.contractingStatusId
                  ? statusById.get(contract.contractingStatusId)
                  : null;
                const mso = c.msoId ? msoById.get(c.msoId) : null;
                const daysOpen = c.submittedDate
                  ? differenceInDays(new Date(), parseISO(c.submittedDate))
                  : null;

                return (
                  <tr
                    key={c.id}
                    onClick={() => onOpenCase(c.id)}
                    className="border-b border-border h-10 cursor-pointer hover:bg-muted/40"
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">
                          {payer?.name ?? '—'}
                        </span>
                        {mso ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-[20px] text-[11px] font-medium border border-border bg-muted text-muted-foreground">
                            via {mso.name}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 text-foreground">{c.state}</td>
                    <td className="px-3 py-1.5">
                      {credSc ? (
                        <StatusPill
                          status={hexToStatusColor(credSc.color)}
                          label={credSc.label}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {contractSc ? (
                        <StatusPill
                          status={hexToStatusColor(contractSc.color)}
                          label={contractSc.label}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 text-foreground tabular-nums">
                      {fmtDate(c.submittedDate)}
                    </td>
                    <td className="px-3 text-right text-foreground tabular-nums">
                      {daysOpen !== null ? `${daysOpen}d` : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IdentityCard({ provider }: { provider: Provider }) {
  const addressLine =
    [provider.homeStreet, provider.homeCity, provider.homeState, provider.homeZip]
      .filter(Boolean)
      .join(', ') || '—';
  const ssn = provider.ssnLast4 ? `xxx-xx-${provider.ssnLast4}` : '—';

  return (
    <Card title="Identity">
      <DL>
        <DRow label="Date of birth" value={fmtDate(provider.dateOfBirth)} />
        <DRow label="SSN" value={ssn} mono />
        <DRow label="Email" value={provider.email ?? '—'} />
        <DRow label="Phone" value={provider.phone ?? '—'} mono />
        <DRow label="Address" value={addressLine} />
      </DL>
    </Card>
  );
}

interface LicensesProps {
  licenses: import('@/services/lookups').StateLicense[];
  loading: boolean;
}

function LicensesCard({ licenses, loading }: LicensesProps) {
  return (
    <Card title="Licenses">
      {loading ? (
        <Skeleton className="h-12 w-full" />
      ) : licenses.length === 0 ? (
        <div className="text-[13px] text-muted-foreground">No licenses on file</div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border">
              <Th>State</Th>
              <Th>Number</Th>
              <Th>Type</Th>
              <Th>Expires</Th>
            </tr>
          </thead>
          <tbody>
            {licenses.map((l) => {
              const expired = l.expirationDate
                ? parseISO(l.expirationDate).getTime() < Date.now()
                : false;
              return (
                <tr key={l.id} className="border-b border-border last:border-0 h-10">
                  <td className="px-3 text-foreground">{l.state}</td>
                  <td className="px-3 text-foreground tabular-nums">
                    {l.licenseNumber ?? '—'}
                  </td>
                  <td className="px-3 text-foreground">{l.licenseType ?? '—'}</td>
                  <td
                    className={`px-3 tabular-nums ${
                      expired ? 'text-[#DC2626] font-medium' : 'text-foreground'
                    }`}
                  >
                    {fmtDate(l.expirationDate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function EmploymentCard({ provider }: { provider: Provider }) {
  return (
    <Card title="Employment & malpractice">
      <DL>
        <DRow label="Specialty" value={provider.specialty ?? '—'} />
        <DRow label="Start date" value={fmtDate(provider.startDate)} />
        <DRow label="Degree" value={provider.degree ?? '—'} />
        <DRow label="School" value={provider.schoolName ?? '—'} />
        <DRow label="Graduation" value={fmtDate(provider.graduationDate)} />
        <DRow label="Carrier" value={provider.malpracticeCarrier ?? '—'} />
        <DRow
          label="Policy #"
          value={provider.malpracticePolicyNumber ?? '—'}
          mono
        />
        <DRow
          label="Coverage"
          value={
            provider.malpracticeCoverageStart || provider.malpracticeCoverageEnd
              ? `${fmtDate(provider.malpracticeCoverageStart)} – ${fmtDate(provider.malpracticeCoverageEnd)}`
              : '—'
          }
        />
      </DL>
    </Card>
  );
}

function CaqhCard({ provider }: { provider: Provider }) {
  const attested = provider.caqhLastAttestedDate;
  let days: number | null = null;
  let cls = 'text-foreground';
  if (attested) {
    days = differenceInDays(new Date(), parseISO(attested));
    if (days >= 110) cls = 'text-[#DC2626] font-medium';
    else if (days >= 90) cls = 'text-[#D97706] font-medium';
  }
  return (
    <Card title="CAQH">
      <DL>
        <DRow label="CAQH ID" value={provider.caqhId ?? '—'} mono />
        <DRow label="Last attested" value={fmtDate(attested)} />
        <DRow
          label="Days since"
          value={
            days === null ? (
              '—'
            ) : (
              <span className={`tabular-nums ${cls}`}>{days}d</span>
            )
          }
        />
      </DL>
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-border rounded-md bg-card">
      <header className="px-4 h-10 flex items-center border-b border-border">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
      {children}
    </h2>
  );
}

function DL({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-3 text-[13px]">{children}</dl>;
}

function DRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground self-center">
        {label}
      </dt>
      <dd className={`text-foreground ${mono ? 'tabular-nums' : ''}`}>{value}</dd>
    </>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-3 h-9 ${className}`}
    >
      {children}
    </th>
  );
}
