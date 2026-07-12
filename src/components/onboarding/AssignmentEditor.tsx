// Group-scoped assignment editor (E1.4 F1.4.2/F1.4.3). Offers ONLY the
// facilities owned by the provider's group(s) (pure facilitiesForProviderGroups
// selector — never the whole org). Every selected location requires a start
// date (DatePicker over the new calendar/popover primitives); the first
// selection defaults to primary and exactly one primary is enforced before
// save (removing the primary forces a re-pick). Hand-picked only — no bulk
// action. Saves through setAssignments (diff sync + atomic RPC swap).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/DatePicker";
import { openSection } from "@/components/onboarding/openSection";
import { useSetAssignments } from "@/hooks/useProviders";
import {
  facilitiesForProviderGroups,
  validateAssignmentDrafts,
  type AssignmentDraft,
} from "@/lib/assignmentScope";
import { ONBOARDING_SECTIONS } from "@/lib/onboardingProgress";
import type { Provider } from "@/types";
import type { SectionBodyProps } from "@/components/onboarding/sectionBodies";

const GROUP_DEF = ONBOARDING_SECTIONS.find((s) => s.key === "provider_group");

export function AssignmentEditor({
  provider,
  wizard,
  onClose,
}: {
  provider: Provider;
  wizard: SectionBodyProps["wizard"];
  onClose: () => void;
}) {
  // The provider's groups come from E1.3's provider_group_assignments rows —
  // the picker scope is their facilities only (locked R3 decision).
  const groupIds = useMemo(
    () =>
      wizard.providerGroupAssignments
        .filter((a) => a.providerId === provider.id)
        .map((a) => a.groupId),
    [wizard.providerGroupAssignments, provider.id],
  );

  const offered = useMemo(
    () => facilitiesForProviderGroups(groupIds, wizard.facilities),
    [groupIds, wizard.facilities],
  );

  const [drafts, setDrafts] = useState<AssignmentDraft[]>(() =>
    wizard.assignments
      .filter((a) => a.providerId === provider.id && a.facilityId !== null)
      .map((a) => ({
        facilityId: a.facilityId as string,
        startDate: a.startDate ?? "",
        isPrimary: a.isPrimary ?? false,
      })),
  );
  const [error, setError] = useState<string | null>(null);

  const saveMut = useSetAssignments(provider.id);
  const byFacility = new Map(drafts.map((d) => [d.facilityId, d]));

  const toggle = (facilityId: string, checked: boolean) => {
    setDrafts((prev) => {
      if (checked) {
        return [...prev, { facilityId, startDate: "", isPrimary: prev.length === 0 }];
      }
      const removed = prev.find((d) => d.facilityId === facilityId);
      let next = prev.filter((d) => d.facilityId !== facilityId);
      // Removing the primary while others remain: promote the first survivor
      // as the default re-pick (still changeable before save).
      if (removed?.isPrimary && next.length > 0 && !next.some((d) => d.isPrimary)) {
        next = next.map((d, i) => ({ ...d, isPrimary: i === 0 }));
      }
      return next;
    });
  };

  const handleSave = () => {
    const validation = validateAssignmentDrafts(drafts);
    setError(validation);
    if (validation) return;
    saveMut.mutate(drafts, {
      onSuccess: () => {
        toast.success("Assignments saved");
        onClose();
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save the assignments"),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>
            Locations for {provider.firstName} {provider.lastName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {offered.length === 0 ? (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">
                No facilities belong to this provider&apos;s group(s) yet — the picker only offers
                the group&apos;s own locations.
              </p>
              {GROUP_DEF ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    onClose();
                    openSection(GROUP_DEF);
                  }}
                >
                  Review groups
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-2">
              {offered.map((f) => {
                const draft = byFacility.get(f.id);
                return (
                  <li key={f.id} className="rounded-md border border-[#E8E5E0] px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex min-w-0 items-center gap-2 text-[13px] text-foreground">
                        <Checkbox
                          checked={Boolean(draft)}
                          onCheckedChange={(v) => toggle(f.id, v === true)}
                          aria-label={`Assign ${f.name}`}
                        />
                        <span className="truncate">
                          {f.name}
                          <span className="ml-1.5 text-[12px] text-muted-foreground">
                            {[f.city, f.state].filter(Boolean).join(", ")}
                          </span>
                        </span>
                      </label>
                      {draft ? (
                        <label className="flex flex-none items-center gap-1.5 text-[12px] text-muted-foreground">
                          <input
                            type="radio"
                            name="primary-location"
                            checked={draft.isPrimary}
                            onChange={() =>
                              setDrafts((prev) =>
                                prev.map((d) => ({ ...d, isPrimary: d.facilityId === f.id })),
                              )
                            }
                            aria-label={`${f.name} is the primary location`}
                            className="h-3.5 w-3.5 accent-[#1B4D3E]"
                          />
                          Primary
                        </label>
                      ) : null}
                    </div>
                    {draft ? (
                      <div className="mt-2 max-w-[220px]">
                        <Label htmlFor={`start-${f.id}`} className="text-[12px]">
                          Start date
                        </Label>
                        <DatePicker
                          id={`start-${f.id}`}
                          value={draft.startDate}
                          ariaLabel={`Start date at ${f.name}`}
                          invalid={Boolean(error) && !draft.startDate}
                          onChange={(startDate) =>
                            setDrafts((prev) =>
                              prev.map((d) => (d.facilityId === f.id ? { ...d, startDate } : d)),
                            )
                          }
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {error ? <p className="text-[12px] text-[#B91C1C]">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saveMut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMut.isPending || offered.length === 0}
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          >
            {saveMut.isPending ? "Saving…" : "Save assignments"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
