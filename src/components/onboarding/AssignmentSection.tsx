// Assignments wizard section body (E1.4 F1.4.1) — the first E1.0 disabled
// preview to go live. Lists every non-terminated provider with facility
// chips (primary starred, start date shown); providers with ZERO assignments
// are flagged and sorted first with an "Assign locations" affordance.
// Progress derives live ("every provider has ≥1 assignment"); the empty
// state points back to the Providers section. One-click primary swap runs
// through the atomic RPC.
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, MapPin, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/StatusPill";
import { AssignmentEditor } from "@/components/onboarding/AssignmentEditor";
import { openSection } from "@/components/onboarding/openSection";
import { useSetPrimaryAssignment } from "@/hooks/useProviders";
import { fmtDate } from "@/lib/format";
import { ONBOARDING_SECTIONS } from "@/lib/onboardingProgress";
import type { Provider } from "@/types";
import type { SectionBodyProps } from "@/components/onboarding/sectionBodies";

const PROVIDERS_DEF = ONBOARDING_SECTIONS.find((s) => s.key === "providers");

export function AssignmentSection({ wizard }: SectionBodyProps) {
  const [editing, setEditing] = useState<Provider | null>(null);
  const setPrimaryMut = useSetPrimaryAssignment();

  const roster = wizard.providers.filter((p) => p.status !== "terminated");
  const facilityById = new Map(wizard.facilities.map((f) => [f.id, f]));
  const assignmentsOf = (providerId: string) =>
    wizard.assignments.filter((a) => a.providerId === providerId);

  if (roster.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-[13px] text-muted-foreground">
          Assignments record where each provider actually practices — add providers first, then
          place them at their locations here.
        </p>
        {PROVIDERS_DEF ? (
          <Button variant="outline" onClick={() => openSection(PROVIDERS_DEF)}>
            <ArrowRight className="h-4 w-4" />
            Go to Providers
          </Button>
        ) : null}
      </div>
    );
  }

  // Unassigned first (F1.4.1), then by name.
  const sorted = [...roster].sort((a, b) => {
    const aGap = assignmentsOf(a.id).length === 0 ? 0 : 1;
    const bGap = assignmentsOf(b.id).length === 0 ? 0 : 1;
    if (aGap !== bGap) return aGap - bGap;
    return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
  });

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {sorted.map((p) => {
          const rows = assignmentsOf(p.id);
          return (
            <li key={p.id} className="rounded-md border border-[#E8E5E0] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-foreground">
                    {p.firstName} {p.lastName}
                  </span>
                  {rows.length === 0 ? (
                    <span className="ml-2 align-middle">
                      <StatusPill status="amber" label="No locations" />
                    </span>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 flex-none px-2 text-[11px]"
                  onClick={() => setEditing(p)}
                >
                  {rows.length === 0 ? "Assign locations" : "Edit locations"}
                </Button>
              </div>
              {rows.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {rows.map((a) => {
                    const facility = a.facilityId ? facilityById.get(a.facilityId) : undefined;
                    return (
                      <li
                        key={a.id}
                        className="flex items-center gap-1.5 rounded-[4px] bg-[var(--mp-neutral-tint)] px-2 py-1 text-[12px] text-[var(--mp-neutral-ink)]"
                      >
                        <MapPin className="h-3 w-3" />
                        <span>{facility?.name ?? "Unknown location"}</span>
                        {a.startDate ? (
                          <span className="text-[11px] opacity-80">
                            since {fmtDate(a.startDate)}
                          </span>
                        ) : null}
                        {a.isPrimary ? (
                          <span
                            className="flex items-center gap-0.5 text-[11px] font-medium"
                            aria-label="Primary practice location"
                          >
                            <Star className="h-3 w-3 fill-current" />
                            Primary
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="text-[11px] underline-offset-2 hover:underline"
                            aria-label={`Make ${facility?.name ?? "this location"} primary for ${p.firstName} ${p.lastName}`}
                            disabled={setPrimaryMut.isPending}
                            onClick={() =>
                              setPrimaryMut.mutate(
                                { providerId: p.id, assignmentId: a.id },
                                {
                                  onSuccess: () => toast.success("Primary location updated"),
                                  onError: (e) =>
                                    toast.error(
                                      e instanceof Error
                                        ? e.message
                                        : "Couldn't change the primary location",
                                    ),
                                },
                              )
                            }
                          >
                            Make primary
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      {editing ? (
        <AssignmentEditor provider={editing} wizard={wizard} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}
