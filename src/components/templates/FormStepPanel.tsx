// E6.5 F6.5.2/F6.5.3/F6.5.4 — the in-editor form machinery for an online_form
// SOP step: register/pick the portal, train its captured mappings (broken
// mappings queue FIRST), and prove the form with a MOCK-DATA dry run — the
// whole capture → train → prove loop without leaving the SOP editor.
//
// Self-contained by design: it fetches through its own org-cached hooks (keyed
// by portalKey) and takes only primitives + row-local callbacks from
// TemplateTaskRow, so the wizard's memo/useCallback render contract stays
// intact (TemplateTaskRow.test.ts + template-typing-latency.spec.ts). The
// panel renders COLLAPSED by default — a summary line only — so Step 3 typing
// never pays for its content.
//
// Dry runs fill from the versioned synthetic mock profile (mockFillProfile.ts)
// — never a provider row, never PHI. Pass = every captured field has a decided,
// auto-fillable mapping; a pass stamps the portal `proven_at` (the funnel's
// Proven state). Capture itself stays extension-side (propose maps from the
// live page); this panel takes over from there.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, FlaskConical } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  useUpdateSharedFieldRegistry,
} from "@/hooks/useMappingReview";
import {
  useSetGlobalPortalFlags,
  useTrainGlobalFieldMap,
  useUpsertGlobalPortal,
  useMarkPortalProven,
} from "@/hooks/useGlobalAuthoring";
import { useCreatePortal } from "@/hooks/usePortals";
import { useRecordTestFill, useTestFills } from "@/hooks/useFormOnboarding";
import { useFormDrift } from "@/hooks/useFormDrift";
import { buildMockTokenMap, MOCK_FILL_PROFILE_VERSION } from "@/lib/mockFillProfile";
import { computeTestRun, summarizeTestFill, type DryRunFieldMap } from "@/lib/testRunResults";
import { normalizePortalKey } from "@/lib/tokenFormat";
import { queryKeys } from "@/hooks/queryKeys";
import type { PortalFieldMap } from "@/types";
import { FieldRegistryList, type RegistryDecision } from "./FieldRegistryList";
import { classifyFieldMap, registryCoverage, type RegistryRow } from "@/lib/fieldRegistry";
import { groupTokens } from "@/lib/tokenGroups";
import type { GlobalTrainPatch } from "@/services/portalFieldMaps";

// Hardcoded-source maps auto-fill from their stored value, not a token; a
// pseudo-token keeps them on computeTestRun's "filled" path (the mock profile
// resolves any token to a non-empty synthetic value).
const HARDCODED_PSEUDO_TOKEN = "hardcoded.value";

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
  /** Writes the registered portal's key back onto the step. */
  onPortalKeyChange?: (portalKey: string) => void;
}

export function FormStepPanel({
  portalKey,
  templatePayerId,
  canEdit,
  isGlobalAuthoring,
  defaultOpen,
  onPortalKeyChange,
}: FormStepPanelProps) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [registerOpen, setRegisterOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const orgId = useActiveOrgId() ?? "no-org";
  const qc = useQueryClient();
  const portalsQ = usePortals();
  const mapsQ = usePortalFieldMaps(portalKey ?? undefined);
  const tokensQ = useTokenCatalog();
  const drift = useFormDrift();
  const testFillsQ = useTestFills(portalKey ?? undefined);

  const approveMut = useApproveField();
  const manualMut = useManualField();
  const trainGlobalMut = useTrainGlobalFieldMap();
  const reproposeMut = useReproposeField();
  const renameMut = useUpdateSharedFieldRegistry();
  const finishTrainingMut = useFinishTraining();
  const globalFlagsMut = useSetGlobalPortalFlags();
  const provenOrgMut = useMarkPortalProven();
  const recordMut = useRecordTestFill();

  const portal = useMemo(
    () =>
      portalKey
        ? (portalsQ.data ?? []).find((p) => normalizePortalKey(p.portalKey) === portalKey)
        : undefined,
    [portalsQ.data, portalKey],
  );

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

  // E6.9: ONE derivation for the read-out, shared with the dry run and the list
  // via the classifier. `brokenIds` doubles as the stale set — a field the
  // latest capture did not see (D7).
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
            ? { status: "approved", source: "token", token: decision.token }
            : decision.kind === "fixed"
              ? { status: "approved", source: "hardcoded", hardcodedValue: decision.value }
              : decision.kind === "human"
                ? { status: "approved", source: "manual" }
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
      } else {
        // A fixed value on an ORG row has no RLS-safe write path today — the
        // shared tier is where trained forms live (D12). Say so rather than
        // failing silently at the database.
        toast.error("Fixed values are set on the shared form library, not on an org override.");
        return;
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

  // F6.5.3 — the mock-data dry run. Proposed rows are deliberately fed a null
  // token so they fail as "needs a decision"; deliberate manual fields are
  // excluded (a human fills them by design); hardcoded rows auto-fill. Pass =
  // zero skipped fields → stamp proven_at.
  async function runDryTest() {
    if (!portal || !portalKey) return;
    setRunning(true);
    try {
      // E6.9 F6.9.4: classify the (status, source) PAIR. The old code filtered
      // `source !== "manual"` BEFORE checking status — and capture writes
      // (proposed, manual), so every undecided captured row vanished from the
      // run meant to surface it, which is how this passed at 4 of 23 mapped.
      // Decided human-fill rows are the ones that legitimately sit out.
      const included = maps.filter((m) => {
        const c = classifyFieldMap(m);
        return c.decision !== "human" && c.decision !== "stale";
      });
      const dryRunMaps: DryRunFieldMap[] = included.map((m) => {
        const c = classifyFieldMap(m);
        return {
          selector: m.selector,
          fieldLabel: m.fieldLabel,
          status: m.status,
          // Autofillable rows carry a fillable key; everything else is fed null
          // so it reports as needing a decision instead of disappearing.
          token: c.autofillable
            ? c.decision === "fixed"
              ? HARDCODED_PSEUDO_TOKEN
              : m.token
            : null,
        };
      });
      const tokenMap = buildMockTokenMap(dryRunMaps.map((d) => d.token));
      const run = computeTestRun(dryRunMaps, tokenMap);
      await recordMut.mutateAsync({
        providerId: null,
        portalKey,
        fieldsFilled: run.fieldsFilled,
        fieldsSkipped: run.fieldsSkipped,
      });
      const pass = run.results.length > 0 && run.fieldsSkipped.length === 0;
      if (pass) {
        if (portal.orgId === null) {
          await globalFlagsMut.mutateAsync({ id: portal.id, proven: true });
        } else {
          await provenOrgMut.mutateAsync(portal.id);
        }
        toast.success(`Mock dry run passed — ${run.fieldsFilled} fields filled. Form proven.`);
      } else if (run.results.length === 0) {
        toast.error("No fillable mappings yet — capture the form fields first.");
      } else {
        toast.error(
          `Mock dry run: ${run.fieldsSkipped.length} field${run.fieldsSkipped.length === 1 ? "" : "s"} unmatched — train them, then re-run.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Dry run failed");
    } finally {
      setRunning(false);
    }
  }

  const latestTest = testFillsQ.data?.[0];
  const latestSummary = latestTest
    ? summarizeTestFill(latestTest.fieldsFilled, latestTest.fieldsSkipped)
    : null;

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
                <span className="font-medium text-foreground">{portal.name}</span>
                {portal.orgId === null ? <StatusPill status="brand" label="Global" /> : null}
                {portal.formUrl ? (
                  <a
                    href={portal.formUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    Open form
                  </a>
                ) : (
                  <span>No form URL</span>
                )}
                {/* Informational only — no readiness semantics (D13). */}
                <span>
                  {coverage.mapped} of {coverage.total} mapped
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

            {portal && maps.length === 0 ? (
              <div className="space-y-1.5 rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#92400E]">
                <p className="font-medium">No form fields captured yet.</p>
                <p>
                  Capture happens in the Minted browser extension, not here. Open this portal
                  {portal.formUrl ? " (use “Open form” above)" : ""}, then in the extension side
                  panel choose <span className="font-medium">“Capture this form”</span> →{" "}
                  <span className="font-medium">“Send for approval.”</span> The proposed mappings
                  land here to train. “Open form” only opens the page — it does not capture.
                </p>
              </div>
            ) : null}

            {/* E6.9 F6.9.3: EVERY row, always — decided rows included. The old
                queue dropped a field the moment it was approved, so a wrong
                mapping was unreachable from the editor. */}
            {portal && maps.length > 0 ? (
              <FieldRegistryList
                rows={maps}
                staleIds={brokenIds}
                canEdit={canEdit}
                groupedTokens={groupedTokens}
                onDecide={decideRegistry}
                onRename={renameRegistryRow}
              />
            ) : null}
            {portal && maps.length > 0 && coverage.needsDecision === 0 ? (
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#1B4D3E]" />
                Every captured field has a decision.
              </p>
            ) : null}

            {portal ? (
              <div className="space-y-1.5 border-t border-[#E8E5E0] pt-2">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={!canEdit || running || maps.length === 0}
                    onClick={() => void runDryTest()}
                  >
                    <FlaskConical className="mr-1 h-3.5 w-3.5" />
                    {running ? "Running…" : "Run mock dry run"}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    Fills from a synthetic profile (v{MOCK_FILL_PROFILE_VERSION}) — no provider data
                    involved. A pass proves the form.
                  </span>
                </div>
                {latestSummary ? (
                  <p className="text-[11.5px] text-muted-foreground">
                    Last run: {latestSummary.filled} filled
                    {latestSummary.unmapped.length > 0 ? (
                      <span className="text-[#B91C1C]">
                        {" "}
                        · {latestSummary.unmapped.length} unmatched (
                        {latestSummary.unmapped
                          .slice(0, 3)
                          .map((f) => f.label)
                          .join(", ")}
                        {latestSummary.unmapped.length > 3 ? ", …" : ""})
                      </span>
                    ) : (
                      " · 0 unmatched"
                    )}
                  </p>
                ) : null}
              </div>
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
    </Collapsible>
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
