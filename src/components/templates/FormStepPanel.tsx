// E6.5 F6.5.2/F6.5.4 — the in-editor form machinery for an online_form SOP
// step: register/pick the portal and train its captured mappings (broken
// mappings queue FIRST). Capture and mock dry-run / Mark proven live in the
// Workbench extension Train forms tab — proven is never stamped from here.
//
// Self-contained by design: it fetches through its own org-cached hooks (keyed
// by portalKey) and takes only primitives + row-local callbacks from
// TemplateTaskRow, so the wizard's memo/useCallback render contract stays
// intact (TemplateTaskRow.test.ts + template-typing-latency.spec.ts). The
// panel renders COLLAPSED by default — a summary line only — so Step 3 typing
// never pays for its content.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import {
  usePortals,
  usePortalFieldMaps,
  useReviewOrgPortalFieldMapBase,
  useStaleOrgOverridesForReview,
} from "@/hooks/usePortals";
import {
  useApproveField,
  useFinishTraining,
  useManualField,
  useTokenCatalog,
  useReproposeField,
  useSetFieldMapHardcoded,
  useSetFieldMapTransform,
  useUpdateSharedFieldRegistry,
  useAddSharedRegistryField,
} from "@/hooks/useMappingReview";
import {
  useSetGlobalPortalFlags,
  useTrainGlobalFieldMap,
  useUpsertGlobalPortal,
} from "@/hooks/useGlobalAuthoring";
import { useCreatePortal } from "@/hooks/usePortals";
import { useFormDrift } from "@/hooks/useFormDrift";
import { createIndependentPortalInput } from "@/lib/portalKey";
import { normalizePortalKey } from "@/lib/tokenFormat";
import { queryKeys } from "@/hooks/queryKeys";
import { FieldRegistryList, type RegistryDecision } from "./FieldRegistryList";
import {
  classifyFieldMap,
  registryCoverage,
  sectionRenamePatches,
  type RegistryRow,
} from "@/lib/fieldRegistry";
import { groupTokens } from "@/lib/tokenGroups";
import { filterMappingTokens } from "@/lib/fillTokenReach";
import type { GlobalTrainPatch } from "@/services/portalFieldMaps";
import { PortalDrawer } from "@/components/PortalDrawer";
import { isPortalHiddenFromPickers, portalDisplayName } from "@/lib/portalRetirement";
import type { CaseType } from "@/lib/caseTypes";
import type { Portal, PortalFieldMap } from "@/types";
import { useLocation } from "@tanstack/react-router";

function describeMappingDecision(map: PortalFieldMap | null): string {
  if (!map) return "No matching shared selector";
  if (map.status !== "approved") return map.status === "retired" ? "Retired" : "Needs a decision";
  if (map.source === "token" || map.source === "manual_partial") {
    return map.token ? `Maps to ${map.token}` : "Approved token mapping without a token";
  }
  if (map.source === "hardcoded") return "Approved fixed value";
  if (map.source === "manual") return "A person fills this field";
  return "Needs review";
}

function selectPortalForFormStep(input: {
  portals: readonly Portal[];
  portalKey: string | null;
  orgId: string;
  templatePayerId: string | null;
  templateCaseType: CaseType | null;
  isGlobalAuthoring: boolean;
}): Portal | undefined {
  const key = normalizePortalKey(input.portalKey ?? "");
  if (!key) return undefined;
  const sameKey = input.portals.filter((portal) => portal.portalKey === key);
  if (sameKey.length === 1) {
    const portal = sameKey[0];
    if (!input.templateCaseType) return portal;
    return portal.payerId === input.templatePayerId &&
      portal.caseType === input.templateCaseType &&
      !isPortalHiddenFromPickers(portal)
      ? portal
      : undefined;
  }

  // Same-key org and shared configurations are distinct MINT-48 scenarios.
  // Resolve the exact owning tier only when both rows confirm the template's
  // payer/type and both require explicit selection; otherwise leave ambiguous
  // references untouched instead of training or reviewing a sibling config.
  if (!input.templatePayerId || !input.templateCaseType) return undefined;
  const selectedScope = input.isGlobalAuthoring ? null : input.orgId;
  const matching = sameKey.filter(
    (portal) =>
      portal.payerId === input.templatePayerId &&
      portal.caseType === input.templateCaseType &&
      portal.requiresExplicitSelection === true &&
      !isPortalHiddenFromPickers(portal),
  );
  const selected = matching.find((portal) => portal.orgId === selectedScope);
  const counterpart = sameKey.find((portal) => portal.orgId !== selectedScope);
  if (!selected || (counterpart && !matching.includes(counterpart))) return undefined;
  return selected;
}

export interface FormStepPanelProps {
  /** The step's portal key, already normalized (null = no portal linked). */
  portalKey: string | null;
  templatePayerId: string | null;
  templateCaseType: CaseType | null;
  canEdit: boolean;
  /** The template is a GLOBAL row — register/train against the global tier. */
  isGlobalAuthoring: boolean;
  /** Slice F — a readiness deep-link (?intent=) lands on this step: mount the
   * panel EXPANDED so the link lands on the work. Read once at mount; every
   * other panel keeps the collapsed default (the latency contract). */
  defaultOpen?: boolean;
  /** Bumped by the portal picker's "Register portal" CTA — expands Form setup
   * and opens the register dialog. Admin > Portals is a redirect shell; this
   * is the only live registration surface. */
  openRegisterSignal?: number;
  /** Writes the registered portal's key back onto the step. */
  onPortalKeyChange?: (portalKey: string) => void;
}

export function FormStepPanel({
  portalKey,
  templatePayerId,
  templateCaseType,
  canEdit,
  isGlobalAuthoring,
  defaultOpen,
  openRegisterSignal = 0,
  onPortalKeyChange,
}: FormStepPanelProps) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [registerOpen, setRegisterOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // PortalStepSelect's "Register portal" button (and the empty-registry path)
  // bumps the signal so registration stays one click away without a dead
  // Admin > Portals hop. Ignore the initial 0 so ordinary mounts stay quiet.
  useEffect(() => {
    if (openRegisterSignal <= 0) return;
    setOpen(true);
    setRegisterOpen(true);
  }, [openRegisterSignal]);

  // Re-expand when an intent deep-link lands (pathname/search change).
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen, location.pathname]);

  const orgId = useActiveOrgId() ?? "no-org";
  const qc = useQueryClient();
  const portalsQ = usePortals();
  const mapsQ = usePortalFieldMaps(portalKey ?? undefined);
  const staleOverridesQ = useStaleOrgOverridesForReview(portalKey ?? undefined);
  const reviewBaseMut = useReviewOrgPortalFieldMapBase();
  const tokensQ = useTokenCatalog();
  const drift = useFormDrift();

  const approveMut = useApproveField();
  const manualMut = useManualField();
  const hardcodedMut = useSetFieldMapHardcoded();
  const transformMut = useSetFieldMapTransform();
  const trainGlobalMut = useTrainGlobalFieldMap();
  const reproposeMut = useReproposeField();
  const renameMut = useUpdateSharedFieldRegistry();
  const addFieldMut = useAddSharedRegistryField();
  const [addFieldLabel, setAddFieldLabel] = useState("");
  const finishTrainingMut = useFinishTraining();
  const globalFlagsMut = useSetGlobalPortalFlags();

  const portal = useMemo(() => {
    return selectPortalForFormStep({
      portals: portalsQ.data ?? [],
      portalKey,
      orgId,
      templatePayerId,
      templateCaseType,
      isGlobalAuthoring,
    });
  }, [portalsQ.data, portalKey, orgId, templatePayerId, templateCaseType, isGlobalAuthoring]);

  async function copyReturnLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Return link copied");
    } catch {
      toast.error("Could not copy the return link");
    }
  }

  const maps = useMemo(
    () => (mapsQ.data ?? []).filter((m) => m.portalKey === portalKey && m.status !== "retired"),
    [mapsQ.data, portalKey],
  );
  const staleOverrides = staleOverridesQ.data ?? [];
  const brokenIds = useMemo(() => {
    const rows = portalKey ? (drift.driftByPortal.get(portalKey) ?? []) : [];
    return new Set(rows.map((m) => m.id));
  }, [drift.driftByPortal, portalKey]);

  // Queue-first ordering (F6.5.4): broken mappings lead, then undecided
  // (proposed) captures. Decided, unbroken rows need no attention.
  const approvedCount = useMemo(() => maps.filter((m) => m.status === "approved").length, [maps]);

  // E6.9: ONE derivation for the coverage read-out and the registry list via
  // the classifier. `brokenIds` doubles as the stale set — map ids the latest
  // real fill reported as not found on the page (form drift, D7).
  const coverage = useMemo(
    () => registryCoverage(maps as RegistryRow[], brokenIds),
    [maps, brokenIds],
  );
  // DYN-TOKEN-06 — the picker offers only what some fill can resolve.
  // payer.*/contract.*/mso.* are case-scoped with no case in hand, so mapping
  // a field to one could only ever leave it blank.
  const groupedTokens = useMemo(
    () => groupTokens(filterMappingTokens(tokensQ.data ?? [])),
    [tokensQ.data],
  );

  const stateLabel: { label: string; tone: StatusColor } = !portal
    ? { label: "Not registered", tone: "neutral" }
    : portal.provenAt
      ? { label: "Proven", tone: "green" }
      : approvedCount > 0
        ? { label: "Trained", tone: "blue" }
        : maps.length > 0
          ? { label: "Captured", tone: "amber" }
          : { label: "Registered · no fields", tone: "amber" };

  const invalidateMaps = () => {
    void qc.invalidateQueries({ queryKey: ["portal-field-maps", orgId] });
    void qc.invalidateQueries({ queryKey: queryKeys.lastFills(orgId) });
  };

  // Flip verification when this decision empties the attention queue — a human
  // has now reviewed every captured field (the markPortalVerified semantic).
  async function maybeFinishTraining(remainingAfter: number) {
    if (remainingAfter > 0 || !portal) return;
    try {
      if (portal.orgId === null) {
        await globalFlagsMut.mutateAsync({
          id: portal.id,
          verified: true,
          expectedMappingGeneration: portal.mappingGeneration,
        });
      } else {
        await finishTrainingMut.mutateAsync({
          portalId: portal.id,
          expectedMappingGeneration: portal.mappingGeneration,
        });
      }
      void qc.invalidateQueries({ queryKey: queryKeys.portals(orgId) });
    } catch {
      // Verification is a convenience stamp; a failure never blocks training.
    }
  }

  // E6.9 F6.9.4 — the three decisions, routed by tier. Shared rows
  // (org_id IS NULL) can only be written through the SECURITY DEFINER RPCs;
  // org rows keep the existing org-RLS paths.
  async function decideRegistry(row: RegistryRow, decision: RegistryDecision) {
    const map = maps.find((m) => m.id === row.id);
    if (!map) return;
    try {
      if (map.orgId === null) {
        const patch: GlobalTrainPatch =
          decision.kind === "token"
            ? {
                status: "approved",
                source: "token",
                token: decision.token,
                // Remapping a token must not wipe authored shaping.
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
        await trainGlobalMut.mutateAsync({
          id: map.id,
          patch: { ...patch, expectedMappingGeneration: map.mappingGeneration },
        });
      } else if (decision.kind === "token") {
        await approveMut.mutateAsync({
          id: map.id,
          token: decision.token,
          fieldLabel: map.fieldLabel,
          expectedMappingGeneration: map.mappingGeneration,
        });
      } else if (decision.kind === "human") {
        await manualMut.mutateAsync({
          id: map.id,
          fieldLabel: map.fieldLabel,
          expectedMappingGeneration: map.mappingGeneration,
        });
      } else if (decision.kind === "unmap") {
        await reproposeMut.mutateAsync({
          id: map.id,
          previous: { token: map.token, source: map.source },
          expectedMappingGeneration: map.mappingGeneration,
        });
      } else if (decision.kind === "fixed") {
        await hardcodedMut.mutateAsync({
          id: map.id,
          value: decision.value,
          fieldLabel: map.fieldLabel,
          expectedMappingGeneration: map.mappingGeneration,
        });
      } else {
        await transformMut.mutateAsync({
          id: map.id,
          transform: decision.transform,
          expectedMappingGeneration: map.mappingGeneration,
        });
      }
      invalidateMaps();
      // Keep the E6.5 verification stamp working: a decision that empties the
      // attention queue means a human has now reviewed every captured field.
      // Unmapping ADDS to the queue, so it never finishes training.
      if (decision.kind !== "unmap") {
        const wasPending = classifyFieldMap(map, { stale: brokenIds.has(map.id) }).needsDecision;
        if (wasPending) await maybeFinishTraining(coverage.needsDecision - 1);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the decision");
    }
  }

  // F6.9.5 — inline rename writes display_label ONLY; the payer's raw
  // field_label is never touched, so a re-capture cannot clobber it.
  async function renameRegistryRow(row: RegistryRow, displayLabel: string | null) {
    const map = maps.find((m) => m.id === row.id);
    if (!map) return;
    if (map.orgId !== null) {
      toast.error("Renaming applies to the shared form library, not to an org override.");
      return;
    }
    try {
      await renameMut.mutateAsync([
        { id: map.id, displayLabel, expectedMappingGeneration: map.mappingGeneration },
      ]);
      invalidateMaps();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename the field");
    }
  }

  // Section headings write the admin `section` column on every row in the
  // group (same shared-tier gate as field rename). Clearing falls back to the
  // captured form_section / page step.
  async function renameRegistrySection(rows: RegistryRow[], section: string | null) {
    if (rows.length === 0) return;
    const shared = rows
      .map((row) => maps.find((m) => m.id === row.id))
      .filter((m): m is NonNullable<typeof m> => Boolean(m));
    if (shared.length === 0) return;
    if (shared.some((m) => m.orgId !== null)) {
      toast.error("Renaming sections applies to the shared form library, not to an org override.");
      return;
    }
    try {
      await renameMut.mutateAsync(
        sectionRenamePatches(shared, section).map((patch) => ({
          ...patch,
          expectedMappingGeneration: shared.find((map) => map.id === patch.id)?.mappingGeneration,
        })),
      );
      invalidateMaps();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename the section");
    }
  }

  // F6.9.6 — the Data-fields "Add field" affordance, folded into the registry.
  // A manual row is a first-class registry row: renameable, sectionable, and
  // decidable by all three actions.
  async function addRegistryField() {
    const label = addFieldLabel.trim();
    if (!label || !portalKey) return;
    try {
      await addFieldMut.mutateAsync({
        portalKey,
        label,
        expectedMappingGeneration: portal?.mappingGeneration,
      });
      setAddFieldLabel("");
      invalidateMaps();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the field");
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border border-[#E8E5E0] bg-muted/20">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
          >
            <span className="flex items-center gap-2 text-xs font-medium">
              Form setup
              <StatusPill status={stateLabel.tone} label={stateLabel.label} />
              {brokenIds.size > 0 ? (
                <StatusPill status="red" label={`${brokenIds.size} broken`} />
              ) : null}
              {coverage.needsDecision > 0 && brokenIds.size === 0 ? (
                <StatusPill status="amber" label={`${coverage.needsDecision} to decide`} />
              ) : null}
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 border-t border-[#E8E5E0] px-3 py-3">
            {!portalKey ? (
              <p className="text-[12px] text-muted-foreground">
                Pick a portal above, or register a new one to link this step.
              </p>
            ) : !portal ? (
              <p className="text-[12px] text-[#92400E]">
                No registered portal matches <code>{portalKey}</code> — register it below.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">{portalDisplayName(portal)}</span>
                {portal.orgId === null ? <StatusPill status="brand" label="Global" /> : null}
                {portal.formUrl ? (
                  <a
                    href={portal.formUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    Open portal
                  </a>
                ) : (
                  <span>No form URL</span>
                )}
                {canEdit ? (
                  <button
                    type="button"
                    className="font-medium text-[#1B4D3E] underline underline-offset-2"
                    onClick={() => setDrawerOpen(true)}
                  >
                    Edit URL
                  </button>
                ) : null}
                {/* Informational only — no readiness semantics (D13). */}
                <span>
                  {coverage.mapped} of {coverage.total} mapped overall
                  {coverage.pages > 0
                    ? ` · ${coverage.pages} page${coverage.pages === 1 ? "" : "s"} captured`
                    : ""}
                  {coverage.needsDecision > 0 ? ` · ${coverage.needsDecision} to decide` : ""}
                </span>
              </div>
            )}

            {canEdit && (!portal || !portalKey) ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setRegisterOpen(true)}
                disabled={!templateCaseType || !templatePayerId}
                title={
                  !templateCaseType
                    ? "Choose a case type in Basics before registering a form configuration."
                    : !templatePayerId
                      ? "Choose a payer in Basics before registering a form configuration."
                      : undefined
                }
              >
                Register {isGlobalAuthoring ? "global " : ""}portal
              </Button>
            ) : null}

            {/* E6.9 F6.9.3: EVERY row, always — decided rows included. The old
                queue dropped a field the moment it was approved, so a wrong
                mapping was unreachable from the editor. */}
            {portal && canEdit ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={addFieldLabel}
                  onChange={(e) => setAddFieldLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addRegistryField();
                  }}
                  placeholder="Add a field by name…"
                  aria-label="Add a field to the registry"
                  className="h-7 w-64 text-[12px]"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[12px]"
                  disabled={addFieldLabel.trim() === ""}
                  onClick={() => void addRegistryField()}
                >
                  Add field
                </Button>
              </div>
            ) : null}

            {portal && maps.length > 0 ? (
              <FieldRegistryList
                rows={maps}
                staleIds={brokenIds}
                canEdit={canEdit}
                groupedTokens={groupedTokens}
                onDecide={decideRegistry}
                onRename={renameRegistryRow}
                onRenameSection={renameRegistrySection}
              />
            ) : null}
            {portal && staleOverrides.length > 0 ? (
              <section
                aria-label="Shared mapping changes need review"
                className="space-y-2 rounded-md border border-amber-300 bg-amber-50/40 p-3"
              >
                <div>
                  <h3 className="text-[13px] font-semibold">Shared mapping changes need review</h3>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    These organization overrides are paused because the shared form mapping changed.
                    Compare each saved decision with the current shared decision before retaining
                    the override.
                  </p>
                </div>
                <ul className="space-y-2">
                  {staleOverrides.map((review) => (
                    <li
                      key={review.map.id}
                      className="rounded-md border border-[#E8E5E0] bg-white p-3 text-[12px]"
                    >
                      <p className="font-medium">
                        Selector <code>{review.map.selector}</code>
                      </p>
                      <p className="mt-1">
                        Organization decision: {describeMappingDecision(review.map)}
                      </p>
                      <p>
                        Current shared decision: {describeMappingDecision(review.currentSharedMap)}
                      </p>
                      {canEdit ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 h-7 text-[12px]"
                          disabled={reviewBaseMut.isPending}
                          onClick={() => {
                            void reviewBaseMut
                              .mutateAsync({
                                id: review.map.id,
                                expectedMappingGeneration: review.map.mappingGeneration ?? 1,
                                expectedSharedBaseGeneration: review.currentSharedBaseGeneration,
                              })
                              .then(() => toast.success("Organization override reviewed."))
                              .catch((error: unknown) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "Could not review the organization override.",
                                ),
                              );
                          }}
                        >
                          {reviewBaseMut.isPending ? "Reviewing…" : "Review and retain override"}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {portal && maps.length > 0 && coverage.needsDecision === 0 ? (
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#1B4D3E]" />
                Every captured field has a decision.
              </p>
            ) : null}

            {portal && !portal.provenAt ? (
              <WorkbenchHandoffBlock
                formUrl={portal.formUrl}
                mode={maps.length === 0 ? "capture" : "prove"}
                onCopyReturnLink={() => void copyReturnLink()}
              />
            ) : null}
          </div>
        </CollapsibleContent>
      </div>

      {registerOpen ? (
        <RegisterPortalDialog
          isGlobalAuthoring={isGlobalAuthoring}
          templatePayerId={templatePayerId}
          templateCaseType={templateCaseType}
          initialKey={portalKey ?? ""}
          onClose={() => setRegisterOpen(false)}
          onRegistered={(key) => {
            setRegisterOpen(false);
            onPortalKeyChange?.(key);
          }}
        />
      ) : null}

      {drawerOpen && portal ? (
        <PortalDrawer
          portal={portal}
          payerId={templatePayerId ?? portal.payerId ?? ""}
          onClose={() => setDrawerOpen(false)}
          onPortalUpdated={() => {
            void qc.invalidateQueries({ queryKey: queryKeys.portals(orgId) });
          }}
        />
      ) : null}
    </Collapsible>
  );
}

function WorkbenchHandoffBlock({
  formUrl,
  mode,
  onCopyReturnLink,
}: {
  formUrl: string | null;
  mode: "capture" | "prove";
  onCopyReturnLink: () => void;
}) {
  const body =
    mode === "capture"
      ? "Capture fields in the Workbench extension (Send for approval). Panel never submits the form."
      : "Run the mock dry run in the Workbench extension, then Mark proven — proven is never automatic.";
  return (
    <div className="space-y-2 rounded-md border border-[#E8E5E0] bg-[#FAFAF9] px-3 py-3">
      <p className="text-[12px] text-muted-foreground">{body}</p>
      <div className="flex flex-wrap items-center gap-3">
        {formUrl ? (
          <a
            href={formUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
          >
            Open portal
          </a>
        ) : null}
        <button
          type="button"
          onClick={onCopyReturnLink}
          className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
        >
          Copy return link to this step
        </button>
      </div>
    </div>
  );
}

type PortalRegistrationInput = {
  name: string;
  portalKey: string;
  payerId: string;
  caseType: CaseType;
  formUrl: string | null;
};

type PortalRegistrationPlan =
  | { mode: "new"; input: PortalRegistrationInput }
  | { mode: "repair"; input: PortalRegistrationInput };

export function buildPortalRegistrationPlan(input: {
  name: string;
  initialKey: string;
  templatePayerId: string | null;
  templateCaseType: CaseType | null;
  formUrl: string;
}): PortalRegistrationPlan {
  const name = input.name.trim();
  const payerId = input.templatePayerId?.trim();
  if (!name) throw new Error("Portal name is required");
  if (!payerId || !input.templateCaseType) {
    throw new Error(
      "Choose a payer and case type in Basics before registering a form configuration",
    );
  }

  const formUrl = input.formUrl.trim() || null;
  const existingKey = normalizePortalKey(input.initialKey);
  if (existingKey) {
    return {
      mode: "repair",
      input: {
        name,
        portalKey: existingKey,
        payerId,
        caseType: input.templateCaseType,
        formUrl,
      },
    };
  }

  return {
    mode: "new",
    input: createIndependentPortalInput({
      name,
      payerId,
      caseType: input.templateCaseType,
      formUrl: input.formUrl,
    }),
  };
}

function RegisterPortalDialog({
  isGlobalAuthoring,
  templatePayerId,
  templateCaseType,
  initialKey,
  onClose,
  onRegistered,
}: {
  isGlobalAuthoring: boolean;
  templatePayerId: string | null;
  templateCaseType: CaseType | null;
  initialKey: string;
  onClose: () => void;
  onRegistered: (portalKey: string) => void;
}) {
  const [name, setName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const upsertGlobalMut = useUpsertGlobalPortal();
  const createOrgMut = useCreatePortal();
  const busy = upsertGlobalMut.isPending || createOrgMut.isPending;
  const repairKey = normalizePortalKey(initialKey);
  const mode = repairKey ? "repair" : "new";

  async function register() {
    let plan: PortalRegistrationPlan;
    try {
      plan = buildPortalRegistrationPlan({
        name,
        initialKey,
        templatePayerId,
        templateCaseType,
        formUrl,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not register the portal");
      return;
    }
    try {
      if (isGlobalAuthoring) {
        await upsertGlobalMut.mutateAsync(plan.input);
      } else {
        await createOrgMut.mutateAsync(plan.input);
      }
      toast.success(
        plan.mode === "repair"
          ? `Portal reference repaired${isGlobalAuthoring ? " globally" : ""}`
          : `Portal registered${isGlobalAuthoring ? " globally" : ""}`,
      );
      onRegistered(plan.input.portalKey);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not register the portal");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "repair" ? "Repair" : "Register"} {isGlobalAuthoring ? "global " : ""}
            portal {mode === "repair" ? "reference" : "configuration"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isGlobalAuthoring ? (
            <p className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#92400E]">
              Registered once, inherited by every organization.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Case type: {templateCaseType ?? "Choose one in Basics"}.{" "}
            {mode === "repair"
              ? "This reconnects the existing SOP reference using its current key. Existing key-scoped maps, references, and proof data stay attached; this does not create a new empty configuration."
              : "This creates a new independent configuration with its own key and no field maps. It starts unverified; training and verification remain separate steps."}
          </p>
          <div>
            <Label className="text-xs">Portal name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="BCBS KS enrollment"
            />
          </div>
          {repairKey ? (
            <div>
              <Label className="text-xs">Existing portal key</Label>
              <Input value={repairKey} readOnly />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Repair keeps this normalized key so existing SOP steps and field maps remain bound.
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              A distinct permanent key is generated when you register this configuration and cannot
              be changed later.
            </p>
          )}
          <div>
            <Label className="text-xs">Form URL (optional)</Label>
            <Input
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void register()}
            disabled={busy}
            style={{ backgroundColor: "#1B4D3E" }}
            className="text-white hover:opacity-90"
          >
            {busy
              ? mode === "repair"
                ? "Repairing…"
                : "Registering…"
              : mode === "repair"
                ? "Repair reference"
                : "Register"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
