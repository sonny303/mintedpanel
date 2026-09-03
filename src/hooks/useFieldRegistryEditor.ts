// The portal field-registry wiring, lifted out of FormStepPanel so the SAME
// training and drift-repair job runs from both hosts: the Template Editor's
// Form setup step and the payer Portals tab drawer (PortalDrawer).
//
// Field maps are keyed by `portal_key` alone — never by template or step — so
// nothing in here needs template context. The write tier is read off each ROW
// (org_id IS NULL = shared, RPC-only) exactly as the editor did it, which is
// why no `isGlobalAuthoring` flag is threaded: that prop only ever governed
// portal REGISTRATION, which stays in the editor.
import { useMemo } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import { usePortalFieldMaps } from "@/hooks/usePortals";
import {
  useAddSharedRegistryField,
  useApproveField,
  useFinishTraining,
  useManualField,
  useReproposeField,
  useSetFieldMapHardcoded,
  useSetFieldMapTransform,
  useTokenCatalog,
  useUpdateSharedFieldRegistry,
} from "@/hooks/useMappingReview";
import { useSetGlobalPortalFlags, useTrainGlobalFieldMap } from "@/hooks/useGlobalAuthoring";
import { useFormDrift } from "@/hooks/useFormDrift";
import {
  classifyFieldMap,
  registryCoverage,
  sectionRenamePatches,
  type RegistryCoverage,
  type RegistryRow,
} from "@/lib/fieldRegistry";
import { groupTokens, type TokenGroup } from "@/lib/tokenGroups";
import { normalizePortalKey } from "@/lib/tokenFormat";
import type { GlobalTrainPatch } from "@/services/portalFieldMaps";
import type { RegistryDecision } from "@/components/templates/FieldRegistryList";
import type { Portal, PortalFieldMap } from "@/types";

export interface UseFieldRegistryEditorArgs {
  /**
   * The registered portal whose fields are being trained. `undefined` means
   * the key names no registered portal yet — the reads still run (empty), and
   * the verification stamp is skipped.
   */
  portal: Portal | undefined;
  /**
   * Key to read maps for. The editor passes the STEP's normalized key, which
   * can name a portal that is not registered yet; the drawer has a row, so it
   * can omit this and the portal's own key is used.
   */
  portalKey?: string | null;
}

export interface FieldRegistryEditor {
  /** Live, non-retired maps for this portal key. */
  rows: PortalFieldMap[];
  /** Map ids the latest real fill reported as not found on the page (drift). */
  staleIds: Set<string>;
  coverage: RegistryCoverage;
  groupedTokens: TokenGroup[];
  approvedCount: number;
  isLoading: boolean;
  isError: boolean;
  decide: (row: RegistryRow, decision: RegistryDecision) => Promise<void>;
  rename: (row: RegistryRow, displayLabel: string | null) => Promise<void>;
  renameSection: (rows: RegistryRow[], section: string | null) => Promise<void>;
  /** Resolves true when the row was written, so the host can clear its input. */
  addField: (label: string) => Promise<boolean>;
}

export function useFieldRegistryEditor({
  portal,
  portalKey,
}: UseFieldRegistryEditorArgs): FieldRegistryEditor {
  // Read with the key as the caller holds it — the editor's step key is
  // already normalized, the drawer's is the stored row value — and compare
  // normalized, so a legacy mixed-case key still matches its own rows.
  const rawKey = portalKey ?? portal?.portalKey ?? null;
  const key = normalizePortalKey(rawKey);
  const orgId = useActiveOrgId() ?? "no-org";
  const qc = useQueryClient();
  const mapsQ = usePortalFieldMaps(rawKey ?? undefined);
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
  const finishTrainingMut = useFinishTraining();
  const globalFlagsMut = useSetGlobalPortalFlags();

  const rows = useMemo(
    () =>
      (mapsQ.data ?? []).filter(
        (m) => normalizePortalKey(m.portalKey) === key && m.status !== "retired",
      ),
    [mapsQ.data, key],
  );
  const staleIds = useMemo(() => {
    const drifted =
      (rawKey ? drift.driftByPortal.get(rawKey) : undefined) ??
      (key ? drift.driftByPortal.get(key) : undefined) ??
      [];
    return new Set(drifted.map((m) => m.id));
  }, [drift.driftByPortal, rawKey, key]);

  const approvedCount = useMemo(() => rows.filter((m) => m.status === "approved").length, [rows]);

  // E6.9: ONE derivation for the coverage read-out and the registry list via
  // the classifier. `staleIds` doubles as the stale set (form drift, D7).
  const coverage = useMemo(
    () => registryCoverage(rows as RegistryRow[], staleIds),
    [rows, staleIds],
  );
  const groupedTokens = useMemo(() => groupTokens(tokensQ.data ?? []), [tokensQ.data]);

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
  async function decide(row: RegistryRow, decision: RegistryDecision) {
    const map = rows.find((m) => m.id === row.id);
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
        const wasPending = classifyFieldMap(map, { stale: staleIds.has(map.id) }).needsDecision;
        if (wasPending) await maybeFinishTraining(coverage.needsDecision - 1);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the decision");
    }
  }

  // F6.9.5 — inline rename writes display_label ONLY; the payer's raw
  // field_label is never touched, so a re-capture cannot clobber it.
  async function rename(row: RegistryRow, displayLabel: string | null) {
    const map = rows.find((m) => m.id === row.id);
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
  async function renameSection(sectionRows: RegistryRow[], section: string | null) {
    if (sectionRows.length === 0) return;
    const shared = sectionRows
      .map((row) => rows.find((m) => m.id === row.id))
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

  // F6.9.6 — a manual row is a first-class registry row: renameable,
  // sectionable, and decidable by all three actions.
  async function addField(label: string): Promise<boolean> {
    const trimmed = label.trim();
    if (!trimmed || !rawKey) return false;
    try {
      await addFieldMut.mutateAsync({ portalKey: rawKey, label: trimmed });
      invalidateMaps();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the field");
      return false;
    }
  }

  return {
    rows,
    staleIds,
    coverage,
    groupedTokens,
    approvedCount,
    isLoading: mapsQ.isLoading || tokensQ.isLoading,
    isError: mapsQ.isError,
    decide,
    rename,
    renameSection,
    addField,
  };
}
