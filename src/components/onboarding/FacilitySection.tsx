// Facilities wizard section body (E1.2 F1.2.1) — mounted through the E1.0
// SECTION_BODIES registry, replacing the E1.0 start placeholder. Lists the
// org's ACTIVE facilities (name, owning group, city/state, hours summary,
// resolved contact incl. the inherited default), opens the CAQH form for
// create/edit, and soft-deletes via is_active=false — never a row delete.
// Progress stays derived (≥1 active facility = Complete).
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
import { FacilityForm } from "@/components/onboarding/FacilityForm";
import { openSection } from "@/components/onboarding/openSection";
import { SectionUploadCard } from "@/components/onboarding/SectionUploadCard";
import { useUpdateFacility } from "@/hooks/useOrgSettings";
import { hoursSummary } from "@/lib/facilityHours";
import { resolveFacilityContact } from "@/lib/facilityContact";
import { ONBOARDING_SECTIONS } from "@/lib/onboardingProgress";
import type { Facility } from "@/types";
import type { SectionBodyProps } from "@/components/onboarding/sectionBodies";

const GROUP_DEF = ONBOARDING_SECTIONS.find((s) => s.key === "provider_group");

function DeactivateConfirm({ facility, onClose }: { facility: Facility; onClose: () => void }) {
  const updateMut = useUpdateFacility(facility.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Deactivate {facility.name}?</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-muted-foreground">
          The location is kept on record but leaves the active list and no longer counts toward
          onboarding progress. You can reactivate it later.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateMut.isPending}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="border-[#FCA5A5] text-[#B91C1C]"
            disabled={updateMut.isPending}
            onClick={() =>
              updateMut.mutate(
                { isActive: false },
                {
                  onSuccess: () => {
                    toast.success("Facility deactivated");
                    onClose();
                  },
                  onError: (e) =>
                    toast.error(
                      e instanceof Error ? e.message : "Couldn't deactivate the facility",
                    ),
                },
              )
            }
          >
            {updateMut.isPending ? "Deactivating…" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FacilitySection({ wizard }: SectionBodyProps) {
  const [modal, setModal] = useState<{ facility: Facility | null } | null>(null);
  const [deactivating, setDeactivating] = useState<Facility | null>(null);

  const activeFacilities = wizard.facilities.filter((f) => f.isActive);
  const activeGroups = wizard.providerGroups.filter((g) => g.isActive);
  const groupById = new Map(wizard.providerGroups.map((g) => [g.id, g]));

  // A facility needs its owning group first (group_id required at the UI
  // level) — point the operator back one section instead of a dead form.
  if (activeGroups.length === 0 && activeFacilities.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-[13px] text-muted-foreground">
          Locations belong to a provider group — add the group first, then capture each place of
          service here.
        </p>
        {GROUP_DEF ? (
          <Button variant="outline" onClick={() => openSection(GROUP_DEF)}>
            <ArrowRight className="h-4 w-4" />
            Go to Provider Group
          </Button>
        ) : null}
        <div className="w-full">
          <SectionUploadCard
            entityKind="facility"
            activeGroupCount={0}
            showPrerequisiteButton={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {activeFacilities.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Add each place of service — address, contact channels, hours, and directory details at the
          grain payer applications ask for.
        </p>
      ) : (
        <ul className="space-y-2">
          {activeFacilities.map((f) => {
            const group = f.groupId ? (groupById.get(f.groupId) ?? null) : null;
            const contact = resolveFacilityContact(
              {
                contactName: f.contactName ?? null,
                phone: f.phone ?? null,
                fax: f.fax ?? null,
                email: f.email ?? null,
              },
              group,
            );
            const summary = hoursSummary(f.hours);
            return (
              <li
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-md border border-[#E8E5E0] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-foreground">{f.name}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {[
                      group?.name,
                      [f.city, f.state].filter(Boolean).join(", "),
                      summary ?? "Hours not set",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {contact.source ? (
                    <div className="text-[12px] text-muted-foreground">
                      {[contact.contactName, contact.phone].filter(Boolean).join(" · ")}
                      {contact.inherited ? (
                        <span className="ml-1.5 text-[11px] uppercase tracking-wide text-[var(--mp-ink-faint)]">
                          Inherited from group
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-none items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setModal({ facility: f })}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px] text-muted-foreground"
                    onClick={() => setDeactivating(f)}
                  >
                    Deactivate
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Button
        onClick={() => setModal({ facility: null })}
        className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
      >
        <Plus className="h-4 w-4" />
        Add facility
      </Button>

      <SectionUploadCard entityKind="facility" activeGroupCount={activeGroups.length} />

      {modal ? (
        <FacilityForm
          facility={modal.facility}
          groups={wizard.providerGroups}
          onClose={() => setModal(null)}
        />
      ) : null}
      {deactivating ? (
        <DeactivateConfirm facility={deactivating} onClose={() => setDeactivating(null)} />
      ) : null}
    </div>
  );
}
