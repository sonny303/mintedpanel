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
import { usePortals, usePortalFieldMaps } from "@/hooks/usePortals";
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
import type { GlobalTrainPatch } from "@/services/portalFieldMaps";
import { PortalDrawer } from "@/components/portals/PortalDrawer";
import { portalDisplayName } from "@/lib/portalRetirement";
import { useLocation } from "@tanstack/react-router";

export interface FormStepPanelProps {
  /** The step's portal key, already normalized (null = no portal linked). */
  portalKey: string | null;
  templatePayerId: string | null;
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

  const portal = useMemo(
    () =>
      portalKey
        ? (portalsQ.data ?? []).find((p) => normalizePortalKey(p.portalKey) === portalKey)
        : undefined,
    [portalsQ.data, portalKey],
  );

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
  const groupedTokens = useMemo(() => groupTokens(tokensQ.data ?? []), [tokensQ.data]);

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
        await globalFlagsMut.mutateAsync({ id: portal.id, verified: true });
      } else {
        await finishTrainingMut.mutateAsync(portal.id);
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
        await trainGlobalMut.mutateAsync({ id: map.id, patch });
      } else if (decision.kind === "token") {
        await approveMut.mutateAsync({
          id: map.id,
          token: decision.token,
          fieldLabel: map.fieldLabel,
        });
      } else if (decision.kind === "human") {
        await manualMut.mutateAsync({ id: map.id, fieldLabel: map.fieldLabel });
      } else if (decision.kind === "unmap") {
        await reproposeMut.mutateAsync({
          id: map.id,
          previous: { token: map.token, source: map.source },
        });
      } else if (decision.kind === "fixed") {
        await hardcodedMut.mutateAsync({
          id: map.id,
          value: decision.value,
          fieldLabel: map.fieldLabel,
        });
      } else {
        await transformMut.mutateAsync({ id: map.id, transform: decision.transform });
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
      await renameMut.mutateAsync([{ id: map.id, displayLabel }]);
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
      await renameMut.mutateAsync(sectionRenamePatches(shared, section));
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
      await addFieldMut.mutateAsync({ portalKey, label });
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
                    Open portal in a new tab (does not capture)
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
            {portal && maps.length > 0 && coverage.needsDecision === 0 ? (
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#1B4D3E]" />
                Every captured field has a decision.
              </p>
            ) : null}

            {portal ? (
              <WorkbenchHandoffBlock
                formUrl={portal.formUrl}
                mode={portal.provenAt ? "maintain" : maps.length === 0 ? "capture" : "prove"}
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
  mode: "capture" | "prove" | "maintain";
  onCopyReturnLink: () => void;
}) {
  const title =
    mode === "capture"
      ? "Finish capture in Minted Workbench"
      : mode === "prove"
        ? "Prove this form in Minted Workbench"
        : "Finish this in Minted Workbench";
  return (
    <div className="space-y-2 rounded-md border border-[#E8E5E0] bg-[#FAFAF9] px-3 py-3">
      <p className="text-[12px] font-semibold text-foreground">{title}</p>
      <p className="text-[12px] text-muted-foreground">
        Minted Panel does not submit payer portal forms and cannot read the live page. Capture and
        prove run in the Workbench Chrome extension.
      </p>
      <ol className="list-decimal space-y-0.5 pl-4 text-[12px] text-muted-foreground">
        <li>Open the form page</li>
        <li>Open the Workbench side panel</li>
        <li>Capture fields (Send for approval)</li>
        <li>Run the mock dry run — no real PHI, nothing submitted</li>
        <li>Mark proven</li>
      </ol>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {formUrl ? (
          <a
            href={formUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
          >
            Open portal in a new tab (does not capture)
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

function RegisterPortalDialog({
  isGlobalAuthoring,
  templatePayerId,
  initialKey,
  onClose,
  onRegistered,
}: {
  isGlobalAuthoring: boolean;
  templatePayerId: string | null;
  initialKey: string;
  onClose: () => void;
  onRegistered: (portalKey: string) => void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState(initialKey);
  const [formUrl, setFormUrl] = useState("");
  const upsertGlobalMut = useUpsertGlobalPortal();
  const createOrgMut = useCreatePortal();
  const busy = upsertGlobalMut.isPending || createOrgMut.isPending;

  async function register() {
    const normalized = normalizePortalKey(key);
    if (!name.trim() || !normalized) {
      toast.error("Portal name and key are required");
      return;
    }
    try {
      if (isGlobalAuthoring) {
        await upsertGlobalMut.mutateAsync({
          name,
          portalKey: normalized,
          payerId: templatePayerId,
          formUrl: formUrl.trim() || null,
        });
      } else {
        await createOrgMut.mutateAsync({
          name,
          portalKey: normalized,
          payerId: templatePayerId,
          formUrl: formUrl.trim() || null,
        });
      }
      toast.success(`Portal registered${isGlobalAuthoring ? " globally" : ""}`);
      onRegistered(normalized);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not register the portal");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Register {isGlobalAuthoring ? "global " : ""}portal</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isGlobalAuthoring ? (
            <p className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#92400E]">
              Registered once, inherited by every organization.
            </p>
          ) : null}
          <div>
            <Label className="text-xs">Portal name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="BCBS KS enrollment"
            />
          </div>
          <div>
            <Label className="text-xs">Portal key</Label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="bcbs_ks_enrollment"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Lowercased on save; immutable after — it joins SOP steps, field maps, and fill logs.
            </p>
          </div>
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
            {busy ? "Registering…" : "Register"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
