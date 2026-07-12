// Providers wizard section body (E1.3 F1.3.1) — mounted through the E1.0
// SECTION_BODIES registry, replacing the E1.0 start placeholder. Lists the
// non-terminated roster (name, credentials, NPI, groups via the M:N
// assignments, license states with soonest expiry, CAQH attestation date),
// opens the CAQH form for create/edit, and soft-deletes via terminated
// status (the existing terminateProvider flow) — never a row delete.
// Progress stays row-presence per the epic's TE-8.
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProviderRosterForm } from "@/components/onboarding/ProviderRosterForm";
import { openSection } from "@/components/onboarding/openSection";
import { useProviderGroupAssignments, useTerminateProvider } from "@/hooks/useProviders";
import { useOrgStateLicenses } from "@/hooks/useLookups";
import { fmtDate } from "@/lib/format";
import { ONBOARDING_SECTIONS } from "@/lib/onboardingProgress";
import type { Provider } from "@/types";
import type { SectionBodyProps } from "@/components/onboarding/sectionBodies";

const GROUP_DEF = ONBOARDING_SECTIONS.find((s) => s.key === "provider_group");

function TerminateConfirm({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const terminateMut = useTerminateProvider(provider.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>
            Terminate {provider.firstName} {provider.lastName}?
          </DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-muted-foreground">
          The provider is kept on record with terminated status (never deleted) and leaves the
          active roster. Payer-termination follow-up tasks are created for any active cases.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={terminateMut.isPending}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="border-[#FCA5A5] text-[#B91C1C]"
            disabled={terminateMut.isPending}
            onClick={() =>
              terminateMut.mutate(
                { terminationDate: new Date().toISOString().slice(0, 10), reason: null },
                {
                  onSuccess: () => {
                    toast.success("Provider terminated");
                    onClose();
                  },
                  onError: (e) =>
                    toast.error(e instanceof Error ? e.message : "Couldn't terminate the provider"),
                },
              )
            }
          >
            {terminateMut.isPending ? "Terminating…" : "Terminate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProviderRosterSection({ wizard }: SectionBodyProps) {
  const [modal, setModal] = useState<{ provider: Provider | null } | null>(null);
  const [terminating, setTerminating] = useState<Provider | null>(null);
  const assignmentsQ = useProviderGroupAssignments();
  const licensesQ = useOrgStateLicenses();

  const roster = wizard.providers.filter((p) => p.status !== "terminated");
  const activeGroups = wizard.providerGroups.filter((g) => g.isActive);
  const groupNameById = new Map(wizard.providerGroups.map((g) => [g.id, g.name]));

  const groupsOf = (providerId: string): string =>
    (assignmentsQ.data ?? [])
      .filter((a) => a.providerId === providerId)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .map((a) => groupNameById.get(a.groupId))
      .filter(Boolean)
      .join(", ");

  const licenseSummaryOf = (providerId: string): string | null => {
    const rows = (licensesQ.data ?? []).filter((l) => l.providerId === providerId);
    if (rows.length === 0) return null;
    const states = [...new Set(rows.map((l) => l.state))].join(", ");
    const expiries = rows
      .map((l) => l.expirationDate)
      .filter((d): d is string => Boolean(d))
      .sort();
    return expiries.length > 0 ? `${states} · soonest expiry ${fmtDate(expiries[0])}` : states;
  };

  // Providers need a group to be assigned to (≥1 assignment is required).
  if (activeGroups.length === 0 && roster.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-[13px] text-muted-foreground">
          Providers are always assigned to a group — add the provider group first, then build the
          roster here.
        </p>
        {GROUP_DEF ? (
          <Button variant="outline" onClick={() => openSection(GROUP_DEF)}>
            <ArrowRight className="h-4 w-4" />
            Go to Provider Group
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {roster.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Add the clinicians you&apos;ll credential — the CAQH-grain profile is captured once and
          reused on every application.
        </p>
      ) : (
        <ul className="space-y-2">
          {roster.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-md border border-[#E8E5E0] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-foreground">
                  {p.firstName} {p.lastName}
                  {p.credentials ? (
                    <span className="text-muted-foreground">, {p.credentials}</span>
                  ) : null}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  {[
                    p.npi ? `NPI ${p.npi}` : null,
                    groupsOf(p.id) || null,
                    licenseSummaryOf(p.id),
                    p.caqhLastAttestedDate
                      ? `CAQH attested ${fmtDate(p.caqhLastAttestedDate)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </div>
              </div>
              <div className="flex flex-none items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setModal({ provider: p })}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px] text-muted-foreground"
                  onClick={() => setTerminating(p)}
                >
                  Terminate
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button
        onClick={() => setModal({ provider: null })}
        className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
      >
        <Plus className="h-4 w-4" />
        Add provider
      </Button>

      {modal ? (
        <ProviderRosterForm
          provider={modal.provider}
          groups={wizard.providerGroups}
          onClose={() => setModal(null)}
        />
      ) : null}
      {terminating ? (
        <TerminateConfirm provider={terminating} onClose={() => setTerminating(null)} />
      ) : null}
    </div>
  );
}
