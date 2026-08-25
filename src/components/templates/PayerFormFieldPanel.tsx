// E6.11 B4/B5 — the payer PDF's field trainer, inside the Payer PDF action's
// upload panel.
//
// Deliberately NOT a second trainer: it renders the same FieldRegistryList,
// token picker, coverage read-out and three decisions (map to a token / fixed
// value / a person fills this) the online-form trainer renders. The only
// differences are where the rows come from — imported from the blank PDF's
// AcroForm fields instead of captured by the extension — and what they are
// keyed on.
//
// KEYED ON THE FORM FAMILY (`payer-form:<familyId>`), not the template and not
// the payer. `payer_forms.family_id` is what a template action points at and it
// survives a replacement, so mapping the 2026 blank keeps working when the
// payer ships the 2027 one; a genuinely different layout is a different family
// and gets its own mappings. Rows are shared-tier (`org_id IS NULL`) like every
// other trained form, so every org benefits from one org's training.
//
// Collapsed by default: Step 2/3 typing latency must not pay for this content
// (the FormStepPanel contract).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusPill } from "@/components/StatusPill";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { usePortalFieldMaps } from "@/hooks/usePortals";
import {
  useImportPdfFormFields,
  useTokenCatalog,
  useUpdateSharedFieldRegistry,
} from "@/hooks/useMappingReview";
import { useTrainGlobalFieldMap } from "@/hooks/useGlobalAuthoring";
import { usePayerFormDownload } from "@/hooks/usePayerForms";
import { pdfFormPortalKey } from "@/lib/pdfFieldImport";
import { registryCoverage, sectionRenamePatches, type RegistryRow } from "@/lib/fieldRegistry";
import { groupTokens } from "@/lib/tokenGroups";
import type { GlobalTrainPatch } from "@/services/portalFieldMaps";
import { FieldRegistryList, type RegistryDecision } from "./FieldRegistryList";

interface PayerFormFieldPanelProps {
  /** The attached form's family — the mapping key. */
  familyId: string;
  /** The attached form ROW: the exact blank whose fields get imported. */
  formId: string;
  canEdit: boolean;
}

export function PayerFormFieldPanel({ familyId, formId, canEdit }: PayerFormFieldPanelProps) {
  const [open, setOpen] = useState(false);
  const portalKey = useMemo(() => pdfFormPortalKey(familyId), [familyId]);
  const orgId = useActiveOrgId() ?? "no-org";
  const qc = useQueryClient();

  const mapsQ = usePortalFieldMaps(portalKey);
  const tokensQ = useTokenCatalog();
  const download = usePayerFormDownload();
  const importMut = useImportPdfFormFields();
  const trainMut = useTrainGlobalFieldMap();
  const renameMut = useUpdateSharedFieldRegistry();

  const maps = useMemo(
    () => (mapsQ.data ?? []).filter((m) => m.portalKey === portalKey && m.status !== "retired"),
    [mapsQ.data, portalKey],
  );
  const coverage = useMemo(() => registryCoverage(maps as RegistryRow[], new Set()), [maps]);
  const groupedTokens = useMemo(() => groupTokens(tokensQ.data ?? []), [tokensQ.data]);

  const invalidateMaps = () => {
    void qc.invalidateQueries({ queryKey: ["portal-field-maps", orgId] });
  };

  async function runImport() {
    try {
      const signed = await download.mutateAsync(formId);
      const result = await importMut.mutateAsync({ familyId, signedUrl: signed.url });
      invalidateMaps();
      if (result.totalFields === 0) {
        toast.error(
          "This PDF has no fillable fields — it is a flat scan, so there is nothing to map yet.",
        );
        return;
      }
      if (result.imported === 0) {
        toast.error(
          `Found ${result.totalFields} field${result.totalFields === 1 ? "" : "s"}, but none can be filled (buttons and signature boxes only).`,
        );
        return;
      }
      setOpen(true);
      toast.success(
        `Imported ${result.imported} field${result.imported === 1 ? "" : "s"}${
          result.skipped > 0 ? ` · skipped ${result.skipped} (buttons, signatures)` : ""
        }`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the fields from that form.");
    }
  }

  // Every PDF row is shared-tier, so all three decisions route through the
  // global training RPC — the same patch shapes the online-form trainer sends.
  async function decideRegistry(row: RegistryRow, decision: RegistryDecision) {
    const map = maps.find((m) => m.id === row.id);
    if (!map) return;
    if (map.orgId !== null) {
      toast.error("Training applies to the shared form library, not to an org override.");
      return;
    }
    const patch: GlobalTrainPatch =
      decision.kind === "token"
        ? {
            status: "approved",
            source: "token",
            token: decision.token,
            transform: map.transform ?? null,
          }
        : decision.kind === "fixed"
          ? { status: "approved", source: "hardcoded", hardcodedValue: decision.value }
          : decision.kind === "human"
            ? { status: "approved", source: "manual" }
            : decision.kind === "transform"
              ? {
                  status: "approved",
                  source: "token",
                  token: map.token,
                  transform: decision.transform,
                }
              : { status: "proposed", source: "manual" };
    try {
      await trainMut.mutateAsync({ id: map.id, patch });
      invalidateMaps();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the decision");
    }
  }

  // display_label only — the PDF's own field label / tooltip is never
  // overwritten, so a re-import cannot clobber a human's naming.
  async function renameRegistryRow(row: RegistryRow, displayLabel: string | null) {
    try {
      await renameMut.mutateAsync([{ id: row.id, displayLabel }]);
      invalidateMaps();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename the field");
    }
  }

  async function renameRegistrySection(rows: RegistryRow[], section: string | null) {
    const shared = rows
      .map((row) => maps.find((m) => m.id === row.id))
      .filter((m): m is NonNullable<typeof m> => Boolean(m));
    if (shared.length === 0) return;
    try {
      await renameMut.mutateAsync(sectionRenamePatches(shared, section));
      invalidateMaps();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename the section");
    }
  }

  const busy = download.isPending || importMut.isPending;
  const stateLabel =
    maps.length === 0
      ? { label: "Fields not imported", tone: "neutral" as const }
      : coverage.needsDecision > 0
        ? { label: `${coverage.needsDecision} to decide`, tone: "amber" as const }
        : { label: "Mapped", tone: "green" as const };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border border-[#E8E5E0] bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
          >
            <span className="flex items-center gap-2 text-xs font-medium">
              Field mapping
              <StatusPill status={stateLabel.tone} label={stateLabel.label} />
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 border-t border-[#E8E5E0] px-3 py-3">
            <p className="text-[12px] text-muted-foreground">
              Map this form&rsquo;s fields to the data the panel already holds, once. Every case
              generated from this template fills them from the provider, group, facility and the
              user running the fill. What a person must still write stays listed as theirs.
            </p>

            {maps.length > 0 ? (
              <p className="text-[12px] text-muted-foreground">
                {coverage.mapped} of {coverage.total} mapped
                {coverage.needsDecision > 0 ? ` · ${coverage.needsDecision} to decide` : ""}
              </p>
            ) : null}

            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px]"
                onClick={() => void runImport()}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileDown className="mr-1.5 h-3.5 w-3.5" />
                )}
                {maps.length === 0 ? "Import fields from the PDF" : "Re-import fields"}
              </Button>
            ) : null}

            {maps.length === 0 && !busy ? (
              <p className="text-[12px] text-muted-foreground">
                Nothing imported yet. Import reads the field names the payer built into the PDF — it
                changes nothing in the file.
              </p>
            ) : null}

            {maps.length > 0 ? (
              <>
                <FieldRegistryList
                  rows={maps}
                  canEdit={canEdit}
                  groupedTokens={groupedTokens}
                  onDecide={decideRegistry}
                  onRename={renameRegistryRow}
                  onRenameSection={renameRegistrySection}
                />
                {coverage.needsDecision === 0 ? (
                  <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#1B4D3E]" />
                    Every imported field has a decision.
                  </p>
                ) : null}
                <p className="border-t border-[#E8E5E0] pt-2 text-[12px] text-muted-foreground">
                  Re-importing after a replaced form refreshes names, sections and order, and adds
                  new fields. Decisions already made are kept.
                </p>
              </>
            ) : null}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
