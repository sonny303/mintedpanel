// Provider Group wizard section body (E1.1 F1.1.1/F1.1.2) — mounted through
// the E1.0 SECTION_BODIES registry, replacing the E1.0 start placeholder.
// Lists the org's ACTIVE groups (name, TIN, states), opens the entity form
// for create/edit, soft-deletes (is_active=false — never a row delete), and
// keeps multi-TIN clients adding via "Add another group" — no confirmation
// gate. Progress flips via derived resolvers only (≥1 active group =
// Complete). The E1.1 inline "Next: Facilities" exit was removed by user
// request (2026-07-19) — step advance belongs to the wizard's NextActionCard,
// which derives the same CTA at the top of the page.
import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProviderGroupForm } from "@/components/onboarding/ProviderGroupForm";
import { SectionUploadCard } from "@/components/onboarding/SectionUploadCard";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { InsurancePanel } from "@/components/groups/InsurancePanel";
import { useUpdateProviderGroup } from "@/hooks/useOrgSettings";
import { useCanWrite } from "@/lib/permissions";
import { formatTin } from "@/lib/providerGroup";
import type { ProviderGroup } from "@/types";
import type { SectionBodyProps } from "@/components/onboarding/sectionBodies";

function DeactivateConfirm({ group, onClose }: { group: ProviderGroup; onClose: () => void }) {
  const updateMut = useUpdateProviderGroup(group.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Deactivate {group.name}?</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-muted-foreground">
          The group is kept on record but leaves the active list and no longer counts toward
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
                    toast.success("Provider group deactivated");
                    onClose();
                  },
                  onError: (e) =>
                    toast.error(e instanceof Error ? e.message : "Couldn't deactivate the group"),
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

// Which per-group drawer is open. Malpractice/insurance coverage is captured
// here (2026-07-29) rather than as fields on the group form — same surface the
// standalone group hub renders, so onboarding and editing are the same job.
type OpenPanel = { groupId: string; panel: "coverage" | "documents" };

export function ProviderGroupSection({ wizard }: SectionBodyProps) {
  const canWrite = useCanWrite();
  const [modal, setModal] = useState<{ group: ProviderGroup | null } | null>(null);
  const [deactivating, setDeactivating] = useState<ProviderGroup | null>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel | null>(null);
  const activeGroups = wizard.providerGroups.filter((g) => g.isActive);
  const isOpen = (groupId: string, panel: OpenPanel["panel"]) =>
    openPanel?.groupId === groupId && openPanel.panel === panel;

  if (activeGroups.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-[13px] text-muted-foreground">
          Set up the legal billing entity this organization operates under — its TIN, Type 2 NPI,
          operating states, and address blocks appear on every payer application.
        </p>
        <Button
          onClick={() => setModal({ group: null })}
          className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
        >
          <Plus className="h-4 w-4" />
          Add provider group
        </Button>
        <div className="w-full">
          <SectionUploadCard entityKind="provider_group" activeGroupCount={0} />
        </div>
        {modal ? <ProviderGroupForm group={modal.group} onClose={() => setModal(null)} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {activeGroups.map((g) => (
          <li key={g.id} className="rounded-md border border-[#E8E5E0] px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-foreground">{g.name}</div>
                <div className="text-[12px] text-muted-foreground">
                  {[
                    g.tin ? `TIN ${formatTin(g.tin)}` : null,
                    g.states?.length ? g.states.join(", ") : null,
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
                  onClick={() => setModal({ group: g })}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px] text-muted-foreground"
                  onClick={() => setDeactivating(g)}
                >
                  Deactivate
                </Button>
              </div>
            </div>
            {/* Malpractice & insurance (primary + any secondary policies) and
                the E4.5 F4.5.1 document table (W-9, COI, CMS-460, Voided
                Check …) — both collapsed by default. */}
            <div className="mt-1.5 flex items-center gap-4">
              {(
                [
                  { panel: "coverage", label: "Malpractice & insurance" },
                  { panel: "documents", label: "Documents" },
                ] as const
              ).map(({ panel, label }) => (
                <button
                  key={panel}
                  type="button"
                  className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
                  aria-expanded={isOpen(g.id, panel)}
                  onClick={() =>
                    setOpenPanel(isOpen(g.id, panel) ? null : { groupId: g.id, panel })
                  }
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${isOpen(g.id, panel) ? "rotate-180" : ""}`}
                  />
                  {label}
                </button>
              ))}
            </div>
            {isOpen(g.id, "coverage") ? (
              <div className="mt-2">
                <InsurancePanel groupId={g.id} canEdit={canWrite} />
              </div>
            ) : null}
            {isOpen(g.id, "documents") ? (
              <div className="mt-2">
                <TooltipProvider delayDuration={200}>
                  <DocumentsPanel ownerType="group" ownerId={g.id} ownerName={g.name} />
                </TooltipProvider>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => setModal({ group: null })}>
          <Plus className="h-4 w-4" />
          Add another group
        </Button>
      </div>

      <SectionUploadCard entityKind="provider_group" activeGroupCount={activeGroups.length} />

      {modal ? <ProviderGroupForm group={modal.group} onClose={() => setModal(null)} /> : null}
      {deactivating ? (
        <DeactivateConfirm group={deactivating} onClose={() => setDeactivating(null)} />
      ) : null}
    </div>
  );
}
