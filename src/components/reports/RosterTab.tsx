// Roster tab of the Reports page. Choose a group + payer (optional state)
// then preview and download a payer roster CSV for matched cases.
import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { downloadCsv } from '@/lib/csv';
import { useCases } from '@/hooks/useCases';
import { useProviders } from '@/hooks/useProviders';
import { usePayers, useStatusConfigs } from '@/hooks/useAdmin';
import { useProviderGroups } from '@/hooks/useLookups';
import { useRosterAux } from '@/hooks/useReports';

const ALL = '__all__';

interface RosterRow {
  lastName: string;
  firstName: string;
  credentials: string;
  npi: string;
  groupNpi: string;
  tin: string;
  taxonomyCode: string;
  facilityName: string;
  facilityAddress: string;
  state: string;
  licenseNumber: string;
  licenseExpiration: string;
  caqhId: string;
  credentialingStatus: string;
  effectiveDate: string;
}

interface RosterAuxFacility {
  id: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'roster';
}

function formatAddress(f: RosterAuxFacility | undefined): string {
  if (!f) return '';
  const parts = [f.street, [f.city, f.state].filter(Boolean).join(', '), f.zip]
    .filter((p) => p && String(p).trim().length > 0);
  return parts.join(' • ');
}

export function RosterTab() {
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();
  const statusesQ = useStatusConfigs('credentialing');
  const providersQ = useProviders();
  const casesQ = useCases();

  const [groupId, setGroupId] = useState<string>('');
  const [payerId, setPayerId] = useState<string>('');
  const [stateSel, setStateSel] = useState<string>(ALL);
  const [generated, setGenerated] = useState<{
    groupId: string;
    payerId: string;
    state: string | null;
  } | null>(null);

  const canGenerate = Boolean(groupId) && Boolean(payerId);

  const states = useMemo(() => {
    const s = new Set<string>();
    (casesQ.data ?? []).forEach((c) => {
      if (!payerId || c.payerId === payerId) {
        if (c.state) s.add(c.state);
      }
    });
    return Array.from(s).sort();
  }, [casesQ.data, payerId]);

  const groupById = useMemo(
    () => new Map((groupsQ.data ?? []).map((g) => [g.id, g])),
    [groupsQ.data],
  );
  const payerById = useMemo(
    () => new Map((payersQ.data ?? []).map((p) => [p.id, p])),
    [payersQ.data],
  );
  const statusById = useMemo(
    () => new Map((statusesQ.data ?? []).map((s) => [s.id, s])),
    [statusesQ.data],
  );

  const matchingCases = useMemo(() => {
    if (!generated) return [];
    return (casesQ.data ?? []).filter((c) => {
      if (c.payerId !== generated.payerId) return false;
      if (c.groupId !== generated.groupId) return false;
      if (generated.state && c.state !== generated.state) return false;
      return true;
    });
  }, [casesQ.data, generated]);

  const auxQ = useRosterAux();

  const rows: RosterRow[] = useMemo(() => {
    if (!generated) return [];
    const providerById = new Map(
      (providersQ.data ?? []).map((p) => [p.id, p]),
    );
    const group = groupById.get(generated.groupId);
    const aux = auxQ.data;
    const facilityById = new Map((aux?.facilities ?? []).map((f) => [f.id, f]));
    const assignmentByProvider = new Map<string, string>();
    (aux?.assignments ?? []).forEach((a) => {
      if (!assignmentByProvider.has(a.providerId)) {
        assignmentByProvider.set(a.providerId, a.facilityId);
      }
    });

    return matchingCases
      .map((cs) => {
        const p = providerById.get(cs.providerId);
        if (!p) return null;
        const status = cs.credentialingStatusId
          ? statusById.get(cs.credentialingStatusId)
          : null;
        const facilityId = cs.facilityId ?? assignmentByProvider.get(p.id) ?? null;
        const facility = facilityId ? facilityById.get(facilityId) : undefined;
        const license = (aux?.licenses ?? []).find(
          (l) => l.providerId === p.id && l.state === cs.state,
        );
        const eff = cs.confirmedEffectiveDate ?? cs.expectedEffectiveDate ?? null;
        return {
          lastName: p.lastName,
          firstName: p.firstName,
          credentials: p.credentials ?? '',
          npi: p.npi ?? '',
          groupNpi: group?.npiType2 ?? '',
          tin: group?.tin ?? '',
          taxonomyCode: p.taxonomyCode ?? '',
          facilityName: facility?.name ?? '',
          facilityAddress: formatAddress(facility),
          state: cs.state,
          licenseNumber: license?.licenseNumber ?? '',
          licenseExpiration: license?.expirationDate
            ? format(parseISO(license.expirationDate), 'yyyy-MM-dd')
            : '',
          caqhId: p.caqhId ?? '',
          credentialingStatus: status?.label ?? '',
          effectiveDate: eff ? format(parseISO(eff), 'yyyy-MM-dd') : '',
        } satisfies RosterRow;
      })
      .filter((r): r is RosterRow => r !== null)
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [generated, providersQ.data, matchingCases, groupById, statusById, auxQ.data]);

  const loading =
    !!generated &&
    (casesQ.isLoading || providersQ.isLoading || statusesQ.isLoading || auxQ.isLoading);

  function handleGenerate() {
    if (!canGenerate) return;
    setGenerated({
      groupId,
      payerId,
      state: stateSel === ALL ? null : stateSel,
    });
  }

  function handleDownload() {
    if (!generated || rows.length === 0) return;
    const group = groupById.get(generated.groupId);
    const payer = payerById.get(generated.payerId);
    const filename = `minted-panel-roster-${slugify(group?.name ?? 'group')}-${slugify(payer?.name ?? 'payer')}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    const header = [
      'Last name',
      'First name',
      'Credentials',
      'NPI (Type 1)',
      'Group NPI (Type 2)',
      'TIN',
      'Taxonomy code',
      'Primary facility name',
      'Primary facility address',
      'State',
      'License number',
      'License expiration',
      'CAQH ID',
      'Credentialing status',
      'Effective date',
    ];
    downloadCsv(filename, [
      header,
      ...rows.map((r) => [
        r.lastName,
        r.firstName,
        r.credentials,
        r.npi,
        r.groupNpi,
        r.tin,
        r.taxonomyCode,
        r.facilityName,
        r.facilityAddress,
        r.state,
        r.licenseNumber,
        r.licenseExpiration,
        r.caqhId,
        r.credentialingStatus,
        r.effectiveDate,
      ]),
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="border border-[#E8E5E0] rounded-md bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Provider group <span className="text-[#DC2626]">*</span>
            </Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="h-9 w-[240px]">
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent>
                {(groupsQ.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Payer <span className="text-[#DC2626]">*</span>
            </Label>
            <Select value={payerId} onValueChange={setPayerId}>
              <SelectTrigger className="h-9 w-[240px]">
                <SelectValue placeholder="Select payer" />
              </SelectTrigger>
              <SelectContent>
                {(payersQ.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              State
            </Label>
            <Select value={stateSel} onValueChange={setStateSel}>
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue placeholder="All states" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All states</SelectItem>
                {states.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!canGenerate}
            onClick={handleGenerate}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
          >
            Generate roster
          </Button>
          {generated && rows.length > 0 && (
            <Button
              variant="outline"
              onClick={handleDownload}
              className="h-9 ml-auto"
            >
              <Download className="h-4 w-4 mr-1" /> Download CSV
            </Button>
          )}
        </div>
      </div>

      {!generated ? (
        <div className="border border-[#E8E5E0] rounded-md bg-white p-12 text-center text-[13px] text-muted-foreground">
          Choose a provider group and payer, then generate the roster.
        </div>
      ) : loading ? (
        <div className="border border-[#E8E5E0] rounded-md bg-white p-4 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : casesQ.isError || providersQ.isError || statusesQ.isError || auxQ.isError ? (
        <div className="border border-[#E8E5E0] rounded-md bg-white p-12 text-center">
          <div className="text-[13px] text-foreground mb-3">Failed to load roster.</div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (casesQ.isError) casesQ.refetch();
              if (providersQ.isError) providersQ.refetch();
              if (statusesQ.isError) statusesQ.refetch();
              if (auxQ.isError) auxQ.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="border border-[#E8E5E0] rounded-md bg-white p-12">
          <EmptyState
            message={`No providers in this group have a case for the selected payer${generated.state ? ` in ${generated.state}` : ''}`}
          />
        </div>
      ) : (
        <div className="border border-[#E8E5E0] rounded-md bg-white overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#E8E5E0] text-xs uppercase tracking-wider text-muted-foreground bg-[#FAFAF9]">
                <th className="text-left px-3 h-10 font-medium">Last name</th>
                <th className="text-left px-3 h-10 font-medium">First name</th>
                <th className="text-left px-3 h-10 font-medium">Credentials</th>
                <th className="text-left px-3 h-10 font-medium">NPI (Type 1)</th>
                <th className="text-left px-3 h-10 font-medium">Group NPI (Type 2)</th>
                <th className="text-left px-3 h-10 font-medium">TIN</th>
                <th className="text-left px-3 h-10 font-medium">Taxonomy</th>
                <th className="text-left px-3 h-10 font-medium">Primary facility</th>
                <th className="text-left px-3 h-10 font-medium">State</th>
                <th className="text-left px-3 h-10 font-medium">License #</th>
                <th className="text-left px-3 h-10 font-medium">License exp.</th>
                <th className="text-left px-3 h-10 font-medium">CAQH ID</th>
                <th className="text-left px-3 h-10 font-medium">Credentialing status</th>
                <th className="text-left px-3 h-10 font-medium">Effective date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.lastName}-${r.firstName}-${r.state}-${i}`}
                  className="border-b border-[#E8E5E0] last:border-b-0 h-10 hover:bg-[#FAFAF9]"
                >
                  <td className="px-3">{r.lastName}</td>
                  <td className="px-3">{r.firstName}</td>
                  <td className="px-3">{r.credentials || '—'}</td>
                  <td className="px-3 tabular-nums">{r.npi || '—'}</td>
                  <td className="px-3 tabular-nums">{r.groupNpi || '—'}</td>
                  <td className="px-3 tabular-nums">{r.tin || '—'}</td>
                  <td className="px-3 tabular-nums">{r.taxonomyCode || '—'}</td>
                  <td className="px-3">
                    {r.facilityName ? (
                      <div className="flex flex-col leading-tight">
                        <span>{r.facilityName}</span>
                        {r.facilityAddress && (
                          <span className="text-muted-foreground text-[11px]">
                            {r.facilityAddress}
                          </span>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3">{r.state}</td>
                  <td className="px-3 tabular-nums">{r.licenseNumber || '—'}</td>
                  <td className="px-3 tabular-nums">{r.licenseExpiration || '—'}</td>
                  <td className="px-3 tabular-nums">{r.caqhId || '—'}</td>
                  <td className="px-3">{r.credentialingStatus || '—'}</td>
                  <td className="px-3 tabular-nums">{r.effectiveDate || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
