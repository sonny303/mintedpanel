// E3.3 F3.3.1/F3.3.2 — the streamlined per-section bulk uploader that sits
// BESIDE each wizard section's manual form (Provider Group, Facilities,
// Providers). One shared composition (TE-10): the E3.0 RosterUploader
// parameterized by entity_kind (TE-4). Admin-gated like the RLS staging writes
// (the org rep is an admin of their own org). TE-5 ladder: the Facilities and
// Providers uploads require ≥1 provider group — when the prerequisite is
// missing, a DISABLED drop zone with a pointer to the Provider Group section is
// rendered instead of accepting a file (never a silent failure). The Provider
// Group upload has no prerequisite.
// 2026-07-20: rendered inside the shared CsvImportPanel disclosure —
// collapsed by default site-wide, matching the Payer Network board pattern.
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CsvImportPanel } from "@/components/import/CsvImportPanel";
import { RosterUploader } from "@/components/import/RosterUploader";
import { useResumableImportRun } from "@/hooks/useImportRuns";
import { openSection } from "@/components/onboarding/openSection";
import { useIsAdmin } from "@/lib/permissions";
import { ONBOARDING_SECTIONS } from "@/lib/onboardingProgress";
import {
  sectionDescriptor,
  uploadLadderGate,
  type SectionEntityKind,
  type SectionScanContext,
} from "@/lib/importSections";

const GROUP_DEF = ONBOARDING_SECTIONS.find((s) => s.key === "provider_group");

export function SectionUploadCard({
  entityKind,
  activeGroupCount,
  showPrerequisiteButton = true,
  scanContext,
  referenceCsv,
}: {
  entityKind: SectionEntityKind;
  /** number of ACTIVE provider groups — the TE-5 ladder input */
  activeGroupCount: number;
  /** hide the card's own "Go to Provider Group" button when the parent already shows one */
  showPrerequisiteButton?: boolean;
  /** E6.4 — scan-time name→id resolution context (provider relationship columns) */
  scanContext?: SectionScanContext;
  /** E6.4 — the prefilled real-names reference sheet download */
  referenceCsv?: { filename: string; text: string };
}) {
  const isAdmin = useIsAdmin();
  const resumableRun = useResumableImportRun("onboarding", entityKind, "streamlined");
  if (!isAdmin) return null;

  const descriptor = sectionDescriptor(entityKind);
  const gate = uploadLadderGate(entityKind, { activeGroupCount });

  return (
    <CsvImportPanel
      label={`Bulk ${descriptor.label.toLowerCase()} import`}
      description="Upload a CSV — rows are validated and staged for review, and nothing changes in your workspace until the import is committed."
      defaultOpen={resumableRun !== undefined}
    >
      {gate.allowed ? (
        <RosterUploader
          source="onboarding"
          variant="streamlined"
          entityKind={entityKind}
          scanContext={scanContext}
          referenceCsv={referenceCsv}
        />
      ) : (
        <div className="space-y-2">
          <div
            className="rounded-md border border-dashed border-[#E8E5E0] bg-white px-4 py-6 text-center text-[12px] text-muted-foreground"
            aria-disabled="true"
          >
            Add a provider group first — imported rows attach to a group.
          </div>
          {GROUP_DEF && showPrerequisiteButton ? (
            <Button variant="outline" onClick={() => openSection(GROUP_DEF)}>
              <ArrowRight className="h-4 w-4" />
              Go to Provider Group
            </Button>
          ) : null}
        </div>
      )}
    </CsvImportPanel>
  );
}
