// Provider detail at /providers/$id. Shows the provider header, cases table
// on the left, and identity/licenses/employment/CAQH cards on the right.
import React, { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { differenceInDays, format, parseISO } from "date-fns";
import { Pencil, Plus, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill, hexToStatusColor, type StatusColor } from "@/components/StatusPill";
import { fmtDate } from "@/lib/format";
import { CopyButton } from "@/components/CopyButton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useProvider, useTerminateProvider } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useContracts } from "@/hooks/useContracts";
import { usePayers, useMsos, useStatusConfigs } from "@/hooks/useAdmin";
import {
  useProviderGroups,
  useNotes,
  useCreateNote,
  useStateLicensesByProvider,
} from "@/hooks/useLookups";
import { useCanWrite } from "@/lib/permissions";
import { NewCaseModal } from "@/components/cases/NewCaseModal";
import { CaseNotesPanel } from "@/components/cases/CaseNotesPanel";
import { SsnVaultField } from "@/components/providers/SsnVaultField";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

import type {
  Contract,
  CredentialCase,
  Mso,
  Payer,
  Provider,
  ProviderGroup,
  ProviderStatus,
  StatusConfig,
} from "@/types";

export const Route = createFileRoute("/providers/$id/")({
  component: ProviderDetailPage,
});

const PROVIDER_STATUS_LABEL: Record<ProviderStatus, string> = {
  onboarding: "Onboarding",
  active: "Active",
  terminated: "Terminated",
};

const PROVIDER_STATUS_COLOR: Record<ProviderStatus, StatusColor> = {
  onboarding: "amber",
  active: "green",
  terminated: "gray",
};

function ProviderDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const canEdit = useCanWrite();
  const canTerminate = useCanWrite();
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [terminateOpen, setTerminateOpen] = useState(false);

  const providerQ = useProvider(id);

  const casesQ = useCases({ providerId: id });
  const contractsQ = useContracts();
  const payersQ = usePayers();
  const msosQ = useMsos();
  const statusesQ = useStatusConfigs();
  const groupsQ = useProviderGroups();

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
    `${groupId ?? ""}|${payerId}|${state}`;

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
        <Button variant="outline" onClick={() => navigate({ to: "/providers" })}>
          Back to providers
        </Button>
      </div>
    );
  }

  const provider = providerQ.data;
  const group = provider.groupId ? (groupById.get(provider.groupId) ?? null) : null;
  const cases = casesQ.data ?? [];

  return (
    <TooltipProvider delayDuration={200}>
      <Header
        provider={provider}
        group={group}
        canEdit={canEdit}
        canTerminate={canTerminate}
        onEdit={() => navigate({ to: "/providers/$id/edit", params: { id: provider.id } })}
        onNewCase={() => setNewCaseOpen(true)}
        onTerminate={() => setTerminateOpen(true)}
      />

      <NewCaseModal
        open={newCaseOpen}
        onOpenChange={setNewCaseOpen}
        provider={provider}
        group={group}
      />
      <TerminateProviderDialog
        open={terminateOpen}
        onOpenChange={setTerminateOpen}
        provider={provider}
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
            onOpenCase={(caseId) => navigate({ to: "/cases/$id", params: { id: caseId } })}
          />
        </div>

        <div className="lg:col-span-2 space-y-4">
          <IdentityCard provider={provider} />
          <LicensesCard provider={provider} />
          <EmploymentCard provider={provider} />
          <CaqhCard provider={provider} />
          <ProviderNotes providerId={provider.id} canEdit={canEdit} />
        </div>
      </div>

      {/* E4.5 F4.5.1 — the provider document store (kind, dates, current
          version, uploader; versioned re-upload; audited signed download). */}
      <div className="mt-6">
        <DocumentsPanel
          ownerType="provider"
          ownerId={provider.id}
          ownerName={`${provider.firstName} ${provider.lastName}`.trim()}
        />
      </div>
    </TooltipProvider>
  );
}

function ProviderNotes({ providerId, canEdit }: { providerId: string; canEdit: boolean }) {
  const notesQ = useNotes("provider", providerId);
  const createNoteM = useCreateNote();
  return (
    <CaseNotesPanel
      notes={notesQ.data ?? []}
      canEdit={canEdit}
      saving={createNoteM.isPending}
      onSaveNote={async (content) => {
        try {
          await createNoteM.mutateAsync({
            entityType: "provider",
            entityId: providerId,
            content,
          });
          toast.success("Note added");
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
    />
  );
}

interface HeaderProps {
  provider: Provider;
  group: ProviderGroup | null;
  canEdit: boolean;
  canTerminate: boolean;
  onEdit: () => void;
  onNewCase: () => void;
  onTerminate: () => void;
}

function Header({
  provider,
  group,
  canEdit,
  canTerminate,
  onEdit,
  onNewCase,
  onTerminate,
}: HeaderProps) {
  const name = `${provider.firstName} ${provider.lastName}${
    provider.credentials ? `, ${provider.credentials}` : ""
  }`;
  const isTerminated = provider.status === "terminated";

  return (
    <div className="pb-4 mb-2 border-b border-border">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{name}</h1>
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
            {isTerminated && provider.terminatedDate ? (
              <>
                <span className="text-border">·</span>
                <span className="text-[#9CA3AF]">
                  Terminated {fmtDate(provider.terminatedDate)}
                </span>
              </>
            ) : null}
          </div>
        </div>

        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit provider
            </Button>

            <Button size="sm" className="gap-2" onClick={onNewCase} disabled={isTerminated}>
              <Plus className="h-4 w-4" />
              New case
            </Button>
            {canTerminate ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={onTerminate}
                disabled={isTerminated}
              >
                <XCircle className="h-4 w-4" />
                {isTerminated ? "Terminated" : "Terminate provider"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface TerminateProviderDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  provider: Provider;
}

function TerminateProviderDialog({ open, onOpenChange, provider }: TerminateProviderDialogProps) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [terminationDate, setTerminationDate] = useState<string>(today);
  const [reason, setReason] = useState<string>("");
  const terminateM = useTerminateProvider(provider.id);
  const canSubmit = Boolean(terminationDate) && !terminateM.isPending;

  async function handleConfirm(): Promise<void> {
    try {
      const result = await terminateM.mutateAsync({
        terminationDate,
        reason: reason.trim() ? reason.trim() : null,
      });
      toast.success(
        result.tasksCreated > 0
          ? `Provider terminated. ${result.tasksCreated} termination task${result.tasksCreated === 1 ? "" : "s"} created.`
          : "Provider terminated.",
      );
      onOpenChange(false);
      setReason("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setTerminationDate(today);
          setReason("");
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Terminate provider</DialogTitle>
          <DialogDescription>
            This sets the provider to Terminated and creates a termination task for every active
            case. It does not delete anything.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Termination date
            </Label>
            <Input
              type="date"
              value={terminationDate}
              onChange={(e) => setTerminationDate(e.target.value)}
              className="h-9 text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Reason
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional context for the termination"
              className="min-h-[80px] text-[13px] resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={terminateM.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canSubmit}>
            {terminateM.isPending ? "Terminating…" : "Terminate provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IdField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>

      <span className="text-foreground tabular-nums">{value ?? "—"}</span>
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
              <TableSkeletonRows rows={4} cols={6} />
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center">
                  <EmptyState message="No cases yet" />
                </td>
              </tr>
            ) : (
              cases.map((c) => {
                const payer = payerById.get(c.payerId);
                const credSc = c.credentialingStatusId
                  ? statusById.get(c.credentialingStatusId)
                  : null;
                const contract = contractByKey.get(contractKey(c.groupId, c.payerId, c.state));
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
                        <span className="font-medium text-foreground">{payer?.name ?? "—"}</span>
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
                        <StatusPill status={hexToStatusColor(credSc.color)} label={credSc.label} />
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
                      {daysOpen !== null ? `${daysOpen}d` : "—"}
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
      .join(", ") || "—";

  return (
    <Card title="Identity">
      <DL>
        <DRow label="Date of birth" value={fmtDate(provider.dateOfBirth)} />
        {/* E4.4 — the full SSN lives only in the server-only vault; this row
            renders the mask plus role-gated vault actions (admin reveal, secure
            store, intake link). */}
        <DRow label="SSN" value={<SsnVaultField provider={provider} />} mono />
        <DRow label="Email" value={provider.email ?? "—"} />
        <DRow label="Phone" value={provider.phone ?? "—"} mono />
        <DRow label="Address" value={addressLine} />
      </DL>
    </Card>
  );
}

function LicensesCard({ provider }: { provider: Provider }) {
  const licensesQ = useStateLicensesByProvider(provider.id);
  const rows = licensesQ.data ?? [];

  if (licensesQ.isLoading) {
    return (
      <Card title="Licenses">
        <div className="text-[13px] text-muted-foreground">Loading…</div>
      </Card>
    );
  }

  if (licensesQ.error) {
    return (
      <Card title="Licenses">
        <div className="text-[13px] text-[#DC2626]">
          Failed to load licenses: {(licensesQ.error as Error).message}
        </div>
      </Card>
    );
  }

  if (rows.length > 0) {
    return (
      <Card title="Licenses">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border">
              <Th>State</Th>
              <Th>Number</Th>
              <Th>Type</Th>
              <Th>Issued</Th>
              <Th>Expires</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const exp = l.expirationDate;
              let expired = false;
              let expiringSoon = false;
              if (exp) {
                const days = (parseISO(exp).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                expired = days < 0;
                expiringSoon = !expired && days <= 90;
              }
              return (
                <tr key={l.id} className="border-b border-border last:border-0 h-10">
                  <td className="px-3 text-foreground">{l.state || "—"}</td>
                  <td className="px-3 text-foreground tabular-nums">{l.licenseNumber ?? "—"}</td>
                  <td className="px-3 text-foreground capitalize">{l.licenseType ?? "—"}</td>
                  <td className="px-3 text-foreground tabular-nums">{fmtDate(l.issueDate)}</td>
                  <td className="px-3 tabular-nums">
                    <span
                      className={
                        expired
                          ? "text-[#DC2626] font-medium"
                          : expiringSoon
                            ? "text-[#D97706] font-medium"
                            : "text-foreground"
                      }
                    >
                      {fmtDate(exp)}
                    </span>
                    {expired ? (
                      <StatusPill status="red" label="Expired" className="ml-2" />
                    ) : expiringSoon ? (
                      <StatusPill status="amber" label="Expiring soon" className="ml-2" />
                    ) : null}
                  </td>
                  <td className="px-3 text-foreground capitalize">{l.status ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    );
  }

  // Fallback to legacy provider columns (only when no state_licenses rows exist).
  const number = provider.licenseNumber;
  if (!number) {
    return (
      <Card title="Licenses">
        <div className="text-[13px] text-muted-foreground">No licenses on file</div>
      </Card>
    );
  }
  const exp = provider.licenseExpirationDate;
  let expired = false;
  let expiringSoon = false;
  if (exp) {
    const days = (parseISO(exp).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expired = days < 0;
    expiringSoon = !expired && days <= 90;
  }
  return (
    <Card title="Licenses">
      <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        Legacy record
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border">
            <Th>State</Th>
            <Th>Number</Th>
            <Th>Issued</Th>
            <Th>Expires</Th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border last:border-0 h-10">
            <td className="px-3 text-foreground">{provider.licenseState ?? "—"}</td>
            <td className="px-3 text-foreground tabular-nums">{number}</td>
            <td className="px-3 text-foreground tabular-nums">
              {fmtDate(provider.licenseIssueDate)}
            </td>
            <td className="px-3 tabular-nums">
              <span
                className={
                  expired
                    ? "text-[#DC2626] font-medium"
                    : expiringSoon
                      ? "text-[#D97706] font-medium"
                      : "text-foreground"
                }
              >
                {fmtDate(exp)}
              </span>
              {expired ? (
                <StatusPill status="red" label="Expired" className="ml-2" />
              ) : expiringSoon ? (
                <StatusPill status="amber" label="Expiring soon" className="ml-2" />
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

function EmploymentCard({ provider }: { provider: Provider }) {
  return (
    <Card title="Employment & malpractice">
      <DL>
        <DRow label="Specialty" value={provider.specialty ?? "—"} />
        <DRow label="Start date" value={fmtDate(provider.startDate)} />
        <DRow label="Degree" value={provider.degree ?? "—"} />
        <DRow label="School" value={provider.schoolName ?? "—"} />
        <DRow label="Graduation" value={fmtDate(provider.graduationDate)} />
        <DRow label="Carrier" value={provider.malpracticeCarrier ?? "—"} />
        <DRow label="Policy #" value={provider.malpracticePolicyNumber ?? "—"} mono />
        <DRow
          label="Coverage"
          value={
            provider.malpracticeCoverageStart || provider.malpracticeCoverageEnd
              ? `${fmtDate(provider.malpracticeCoverageStart)} – ${fmtDate(provider.malpracticeCoverageEnd)}`
              : "—"
          }
        />
      </DL>
    </Card>
  );
}

function CaqhCard({ provider }: { provider: Provider }) {
  const attested = provider.caqhLastAttestedDate;
  let days: number | null = null;
  let cls = "text-foreground";
  if (attested) {
    days = differenceInDays(new Date(), parseISO(attested));
    if (days >= 110) cls = "text-[#DC2626] font-medium";
    else if (days >= 90) cls = "text-[#D97706] font-medium";
  }
  return (
    <Card title="CAQH">
      <DL>
        <DRow label="CAQH ID" value={provider.caqhId ?? "—"} mono />
        <DRow label="Last attested" value={fmtDate(attested)} />
        <DRow
          label="Days since"
          value={days === null ? "—" : <span className={`tabular-nums ${cls}`}>{days}d</span>}
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

function DRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground self-center">
        {label}
      </dt>
      <dd className={`text-foreground ${mono ? "tabular-nums" : ""}`}>{value}</dd>
    </>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-3 h-9 ${className}`}
    >
      {children}
    </th>
  );
}
