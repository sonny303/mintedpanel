// The contract dialog behind every Group Contracts Matrix cell (GCM-9). It
// edits the record at group × payer × state × specialty: status, dates, notes
// and the contract SOP. "Covers" says whether the record is one specialty's or
// the group's all-specialties agreement (GCM-32), "Also apply" copies the
// status and dates to the payer's other states for the same group (GCM-27),
// and billing users get the same dialog read-only (GCM-10).
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpsertContract } from "@/hooks/useContracts";
import { useStatusConfigs } from "@/hooks/useAdmin";
import { ContractSopAssignmentPanel } from "@/components/reports/ContractSopAssignmentPanel";
import { supabase } from "@/integrations/supabase/externalClient";
import { useActiveOrgId } from "@/lib/auth-store";
import { canonicalLabel } from "@/lib/canonicalStatuses";
import { CONTRACT_SPECIALTY_LABELS, type ContractSpecialty } from "@/lib/contractSpecialty";
import { useCanWrite } from "@/lib/permissions";
import { NOT_STARTED_LABEL } from "@/lib/statusLabels";
import { normalizePortalKey } from "@/lib/tokenFormat";
import { cn } from "@/lib/utils";
import { listEffectivePortalMapResolutions } from "@/services/portalFieldMaps";
import type { Contract, ContractSpecialtyKey } from "@/types";
import {
  alsoApplySplitsShared,
  contractCoversExplanation,
  contractCoversLabel,
  contractCoversMode,
  contractSaveSplitsShared,
  joinStates,
  planContractSaves,
  type AlsoApplyTarget,
} from "./contractDetailPlan";

interface ContractDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  contract: Contract | null;
  groupId: string;
  payerId: string;
  state: string;
  groupName?: string;
  groupTin?: string | null;
  payerName?: string;
  /** The specialty table the dialog was opened from. Absent: no Covers row,
   * and a save keeps the record's own specialty (`all` for a new one). */
  specialty?: ContractSpecialty;
  /** The group already holds an all-specialties record for this payer and
   * state, so a new record cannot become one. */
  allRecordExists?: boolean;
  /** The payer's other open states for this group in the same table, each
   * with what its cell shows now (GCM-27). */
  alsoApplyTargets?: readonly AlsoApplyTarget[];
  /** The specialty tables that currently show `contract` (when it is the
   * shared record), so the dialog names only tables that really show it. */
  sharedIn?: readonly ContractSpecialty[];
}

const FIELD_LABEL = "text-[12px] font-medium text-[var(--mp-ink)]";

export function ContractDetailDrawer({
  open,
  onClose,
  contract,
  groupId,
  payerId,
  state,
  groupName,
  groupTin,
  payerName,
  specialty,
  allRecordExists = false,
  alsoApplyTargets = [],
  sharedIn = [],
}: ContractDetailDrawerProps) {
  const canWrite = useCanWrite();
  const readOnly = !canWrite;
  const upsertM = useUpsertContract();
  const statusesQ = useStatusConfigs("contracting");
  const activeOrgId = useActiveOrgId();
  const portalResolutionsQ = useQuery({
    queryKey: ["contract-sop-portal-resolutions", activeOrgId ?? "no-org", "web"],
    queryFn: () =>
      listEffectivePortalMapResolutions(
        { db: supabase, orgId: activeOrgId as string },
        { mapType: "web" },
      ),
    enabled: open && Boolean(activeOrgId) && Boolean(contract?.id),
    staleTime: 30_000,
  });
  const portalConfigurationForKey = useMemo(() => {
    if (!portalResolutionsQ.data) return undefined;
    const byKey = new Map(
      portalResolutionsQ.data.flatMap((resolution) => {
        const key = normalizePortalKey(resolution.portalKey);
        return key ? [[key, resolution] as const] : [];
      }),
    );
    return (portalKey: string) => {
      const key = normalizePortalKey(portalKey);
      if (!key) return null;
      // The canonical list omits a key with neither a config nor maps. Treat
      // that successful absence as the resolver's explicit missing state.
      return (
        byKey.get(key) ?? {
          portalKey: key,
          portalId: null,
          ownerScope: null,
          ownerOrgId: null,
          caseType: null,
          formUrl: null,
          payerId: null,
          requiresExplicitSelection: false,
          mappingGeneration: null,
          effectiveMappingFingerprint: null,
          maps: [],
          activeFieldCount: 0,
          isVerified: false,
          isReady: false,
          status: "configuration_missing" as const,
        }
      );
    };
  }, [portalResolutionsQ.data]);
  const portalResolverState = !activeOrgId
    ? "unavailable"
    : portalResolutionsQ.isError
      ? "error"
      : portalResolutionsQ.isPending
        ? "loading"
        : "ready";

  const coversMode = contractCoversMode({ specialty, contract, allRecordExists });
  const [covers, setCovers] = useState<ContractSpecialtyKey>(
    coversMode.kind === "choice" ? coversMode.initial : coversMode.key,
  );
  const [statusId, setStatusId] = useState<string>(contract?.contractingStatusId ?? "");
  const [tentativeDate, setTentativeDate] = useState<string>(
    contract?.tentativeEffectiveDate ?? "",
  );
  const [effectiveDate, setEffectiveDate] = useState<string>(contract?.effectiveDate ?? "");
  const [expirationDate, setExpirationDate] = useState<string>(contract?.expirationDate ?? "");
  const [notes, setNotes] = useState<string>(contract?.notes ?? "");
  const [alsoApply, setAlsoApply] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const statuses = statusesQ.data ?? [];
  // A new record starts at Not Started (matched by label, never by id).
  const defaultStatusId = contract
    ? ""
    : (statuses.find((s) => canonicalLabel(s.label) === NOT_STARTED_LABEL)?.id ?? "");
  const statusValue = statusId || defaultStatusId;

  const upperState = state.toUpperCase();
  const applyTargets = useMemo(() => {
    const seen = new Set<string>([upperState]);
    const out: AlsoApplyTarget[] = [];
    for (const target of alsoApplyTargets) {
      const code = target.state.toUpperCase();
      if (seen.has(code)) continue;
      seen.add(code);
      out.push({ ...target, state: code });
    }
    return out.sort((a, b) => a.state.localeCompare(b.state));
  }, [alsoApplyTargets, upperState]);
  const groupLabel = groupName ?? "this group";
  const specialtyLabel = specialty ? CONTRACT_SPECIALTY_LABELS[specialty] : null;
  const explanation = contractCoversExplanation({
    mode: coversMode,
    selected: covers,
    groupName: groupLabel,
    state: upperState,
    sharedElsewhere: sharedIn.filter((other) => other !== specialty),
  });
  // "<Specialty> only" on a shared record: the record the SOP would belong to
  // does not exist until the save (GCM-32).
  const splitting = contractSaveSplitsShared(coversMode, covers);
  const splitSuffix = specialtyLabel ? ` (records ${specialtyLabel} separately)` : "";
  const targetSuffix = (target: AlsoApplyTarget) =>
    alsoApplySplitsShared(target, covers, specialty) ? splitSuffix : "";

  function toggleApplyState(code: string, checked: boolean) {
    setAlsoApply((current) =>
      checked ? [...new Set([...current, code])] : current.filter((s) => s !== code),
    );
  }

  async function handleSave() {
    if (readOnly) return;
    if (!groupId || !payerId || !state) {
      toast.error("Group, payer, and state are required.");
      return;
    }
    const plan = planContractSaves({
      groupId,
      payerId,
      state,
      specialtyKey: covers,
      tableSpecialty: specialty ?? null,
      draft: {
        contractingStatusId: statusValue || null,
        tentativeEffectiveDate: tentativeDate.trim() || null,
        effectiveDate: effectiveDate.trim() || null,
        expirationDate: expirationDate.trim() || null,
        notes: notes.trim() || null,
      },
      alsoApply: applyTargets.filter((target) => alsoApply.includes(target.state)),
    });
    setSaving(true);
    try {
      await upsertM.mutateAsync(plan.primary);
    } catch (err) {
      setSaving(false);
      toast.error(err instanceof Error ? err.message : "Failed to save the contract.");
      return;
    }
    // Each state is its own record, audit row and status history (GCM-27).
    const failed: string[] = [];
    for (const input of plan.alsoApply) {
      try {
        await upsertM.mutateAsync(input);
      } catch {
        failed.push(input.state);
      }
    }
    setSaving(false);
    if (failed.length > 0) {
      toast.error(
        `Saved ${upperState}, but these states were not updated: ${joinStates(failed)}. Open them to try again.`,
      );
    } else if (plan.alsoApply.length > 0) {
      toast.success(
        `Contract saved for ${joinStates([upperState, ...plan.alsoApply.map((i) => i.state)])}.`,
      );
    } else {
      toast.success("Contract saved.");
    }
    onClose();
  }

  const busy = saving || upsertM.isPending;
  const tinText = groupTin?.trim() ? `TIN ${groupTin.trim()}` : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--mp-ink-secondary)]">
            Group contract{specialtyLabel ? ` · ${specialtyLabel} table` : ""}
          </p>
          <DialogTitle className="text-lg font-semibold">
            {payerName ?? "Payer"} — {upperState}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[var(--mp-ink-secondary)]">
            {[groupName ?? "Group", tinText].filter(Boolean).join(" · ")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          {readOnly ? (
            <p className="rounded-md bg-[var(--mp-muted)] px-3 py-2 text-[13px] text-[var(--mp-ink)]">
              View only. Billing users can see contract details but not change them.
            </p>
          ) : null}

          {coversMode.kind === "none" ? null : (
            <div className="space-y-1.5">
              <p id="contract-covers-label" className={FIELD_LABEL}>
                Covers
              </p>
              {coversMode.kind === "choice" && !readOnly ? (
                <CoversChoice
                  labelledBy="contract-covers-label"
                  value={covers}
                  onChange={setCovers}
                  disabled={busy}
                  options={[
                    { key: "all", disabled: !coversMode.allowAll },
                    { key: coversMode.specialty, disabled: false },
                  ]}
                />
              ) : (
                <p className="text-[13px] text-[var(--mp-ink)]" data-testid="contract-covers-value">
                  {contractCoversLabel(covers)}
                </p>
              )}
              {explanation && !readOnly ? (
                <p className="rounded-md bg-[var(--mp-muted)] px-3 py-2 text-[13px] text-[var(--mp-ink)]">
                  {explanation}
                </p>
              ) : null}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Contracting status</Label>
            <Select value={statusValue} onValueChange={setStatusId} disabled={readOnly || busy}>
              <SelectTrigger aria-label="Contracting status">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="contract-tentative-date" className={FIELD_LABEL}>
                Tentative date
              </Label>
              <Input
                id="contract-tentative-date"
                type="date"
                value={tentativeDate}
                disabled={readOnly || busy}
                onChange={(e) => setTentativeDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contract-effective-date" className={FIELD_LABEL}>
                Effective date
              </Label>
              <Input
                id="contract-effective-date"
                type="date"
                value={effectiveDate}
                disabled={readOnly || busy}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contract-expiration-date" className={FIELD_LABEL}>
                Expiration date
              </Label>
              <Input
                id="contract-expiration-date"
                type="date"
                value={expirationDate}
                disabled={readOnly || busy}
                onChange={(e) => setExpirationDate(e.target.value)}
              />
            </div>
          </div>

          {!readOnly && applyTargets.length > 0 ? (
            <fieldset className="space-y-2 rounded-md border border-[var(--mp-border)] px-3 py-2.5">
              {applyTargets.length === 1 ? (
                <label className="flex items-start gap-2 text-[13px] text-[var(--mp-ink)]">
                  <Checkbox
                    className="mt-0.5"
                    checked={alsoApply.includes(applyTargets[0].state)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      toggleApplyState(applyTargets[0].state, checked === true)
                    }
                  />
                  <span>
                    Also apply this status and these dates to {applyTargets[0].state} for{" "}
                    {groupLabel}
                    {targetSuffix(applyTargets[0])}
                  </span>
                </label>
              ) : (
                <>
                  <legend className="px-1 text-[13px] text-[var(--mp-ink)]">
                    Also apply this status and these dates for {groupLabel} to:
                  </legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {applyTargets.map((target) => (
                      <label
                        key={target.state}
                        className="flex items-center gap-2 text-[13px] text-[var(--mp-ink)]"
                      >
                        <Checkbox
                          checked={alsoApply.includes(target.state)}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            toggleApplyState(target.state, checked === true)
                          }
                        />
                        {target.state}
                        {targetSuffix(target)}
                      </label>
                    ))}
                  </div>
                </>
              )}
              <p className="text-[12px] text-[var(--mp-ink-secondary)]">
                Each state is saved as its own record. Notes stay with this state.
              </p>
            </fieldset>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="contract-notes" className={FIELD_LABEL}>
              Notes &amp; cross-payer dependencies
            </Label>
            <Textarea
              id="contract-notes"
              rows={3}
              placeholder="e.g. Effective only after the Medicare enrollment is loaded"
              value={notes}
              disabled={readOnly || busy}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {splitting ? (
            <section
              aria-label="Contract SOP assignment"
              className="space-y-1 rounded-md border border-[var(--mp-border)] p-3"
            >
              <h3 className="font-medium">Contract SOP</h3>
              <p className="text-[12px] text-[var(--mp-ink-secondary)]">
                Save first to assign this record&apos;s SOP.
              </p>
            </section>
          ) : (
            // A disabled fieldset makes the SOP panel's own controls read-only
            // for billing users without changing the panel.
            <fieldset disabled={readOnly} className="min-w-0">
              <ContractSopAssignmentPanel
                contract={contract}
                groupId={groupId}
                payerId={payerId}
                state={state}
                orgId={activeOrgId}
                portalConfigurationForKey={portalConfigurationForKey}
                portalResolverState={portalResolverState}
              />
            </fieldset>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {readOnly ? (
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={busy}
                className="bg-[var(--mp-primary)] text-white hover:bg-[var(--mp-primary-hover)]"
              >
                {busy ? "Saving…" : "Save contract"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The Covers choice as an ARIA radio group: one tab stop (the checked
 * option), arrow keys move and select, disabled options are skipped. */
function CoversChoice({
  labelledBy,
  value,
  onChange,
  disabled,
  options,
}: {
  labelledBy: string;
  value: ContractSpecialtyKey;
  onChange: (key: ContractSpecialtyKey) => void;
  disabled: boolean;
  options: readonly { key: ContractSpecialtyKey; disabled: boolean }[];
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.flatMap((option, index) => (option.disabled ? [] : [index]));

  function move(from: number, step: 1 | -1) {
    if (enabled.length === 0) return;
    const at = enabled.indexOf(from);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    onChange(options[next].key);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="inline-flex h-[34px] items-center gap-[2px] rounded-[var(--mp-radius-sm)] bg-[var(--mp-muted)] p-[3px]"
    >
      {options.map((option, index) => {
        const selected = option.key === value;
        return (
          <button
            key={option.key}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled || disabled}
            onClick={() => onChange(option.key)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(index, -1);
              }
            }}
            className={cn(
              "inline-flex h-full items-center rounded-[var(--mp-radius-control)] border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--mp-focus)] disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "border-[var(--mp-border)] bg-[var(--mp-card)] text-[var(--mp-ink)]"
                : "border-transparent text-[var(--mp-ink-secondary)] hover:text-[var(--mp-ink)]",
            )}
          >
            {contractCoversLabel(option.key)}
          </button>
        );
      })}
    </div>
  );
}
