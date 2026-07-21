// E6.4 F6.4.4 — enrollment-fact capture on the provider record. Facts record
// "already enrolled with this payer UNDER THIS GROUP'S CONTRACT" (migration
// truth) — they count the payer Active on the board, suppress the generation
// candidate, and NEVER create a case. Prior-employer status does not belong
// here: a new hire gets the full path regardless (the guard text below is the
// epic's labeling requirement). Expire is a FLIP (audited) that immediately
// re-opens the candidate in the group's buffer.
// 2026-07-20 re-scope: the payer-issued enrollment ID (PIN) is captured HERE,
// on the enrollment it belongs to — optional at capture, editable after (the
// approval letter often arrives later). The field label is the payer's own
// Minted-curated term via the resolveIdentifierConfig seam.
// 2026-07-21 — ONE enrollment picture: APPROVED cases derive rows here too
// (providerEnrollments reducer), carrying the effective date + payer-issued
// ID the approval captured on the case — resolving a case updates this view
// with zero re-entry and zero dual writes ("From case" rows are read-only
// links; corrections happen on the case and re-derive).
// 2026-07-21 status/action cleanup (user handoff): live rows say "Active"
// (the standard vocabulary — "Live" was a drift) and the row-level Expire
// button is GONE (no user value on this surface). expireEnrollmentFact stays
// in the service/hook layer — expiry is still the data model's re-open flip,
// just no longer a provider-record affordance.
// 2026-07-21 provider-detail redesign — renders its OWN RecordSectionCard
// ("Enrollments") with the shared "+ Add enrollment" affordance in the header
// (handoff issues 1 & 7).
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { DatePicker } from "@/components/DatePicker";
import { StateSelect } from "@/components/StateSelect";
import { StatusPill } from "@/components/StatusPill";
import { AddButton, RecordSectionCard } from "@/components/providers/RecordSectionCard";
import {
  useCreateEnrollmentFact,
  useEnrollmentFacts,
  useSetEnrollmentFactIdentifier,
} from "@/hooks/useEnrollmentFacts";
import { useCases } from "@/hooks/useCases";
import { useProviderGroupAssignments } from "@/hooks/useProviders";
import { useProviderGroups } from "@/hooks/useLookups";
import { usePayers } from "@/hooks/useAdmin";
import { fmtDate } from "@/lib/format";
import { resolveIdentifierConfig } from "@/lib/payerResolutionIdentifier";
import { buildProviderEnrollmentRows } from "@/lib/providerEnrollments";
import type { EnrollmentFact } from "@/types";

export const ENROLLMENT_GUARD_TEXT =
  "Enrollments recorded here are under this group's contract only. Prior-employer status does NOT belong here — a new hire gets the full credentialing path regardless.";

export function EnrollmentsPanel({
  providerId,
  canWrite,
}: {
  providerId: string;
  canWrite: boolean;
}) {
  const factsQ = useEnrollmentFacts();
  // The record page already holds this org cache (its Cases panel) — free read.
  const casesQ = useCases();
  const groupAssignQ = useProviderGroupAssignments();
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();
  const createFact = useCreateEnrollmentFact();

  const [adding, setAdding] = useState(false);
  const [groupDraft, setGroupDraft] = useState("");
  const [payerDraft, setPayerDraft] = useState("");
  const [stateDraft, setStateDraft] = useState("");
  const [dateDraft, setDateDraft] = useState("");
  const [pinDraft, setPinDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<EnrollmentFact | null>(null);

  // The PIN field is labeled with the selected payer's own Minted-curated
  // term ("Provider ID", "PTAN", …) — generic "Payer-issued ID" otherwise.
  const draftPayer = (payersQ.data ?? []).find((p) => p.id === payerDraft) ?? null;
  const draftPinLabel = resolveIdentifierConfig(draftPayer).individualLabel;

  const myGroups = useMemo(
    () =>
      (groupAssignQ.data ?? [])
        .filter((a) => a.providerId === providerId && a.groupId)
        .map((a) => ({
          id: a.groupId as string,
          name: (groupsQ.data ?? []).find((g) => g.id === a.groupId)?.name ?? "—",
        })),
    [groupAssignQ.data, groupsQ.data, providerId],
  );

  const myRows = useMemo(
    () =>
      buildProviderEnrollmentRows(providerId, factsQ.data ?? [], casesQ.data ?? [])
        .map((row) => {
          const rowPayer = (payersQ.data ?? []).find((p) => p.id === row.payerId) ?? null;
          return {
            ...row,
            payerName: rowPayer?.name ?? "—",
            pinLabel: resolveIdentifierConfig(rowPayer).individualLabel,
            groupName: (groupsQ.data ?? []).find((g) => g.id === row.groupId)?.name ?? "—",
          };
        })
        .sort((a, b) => a.payerName.localeCompare(b.payerName) || a.state.localeCompare(b.state)),
    [factsQ.data, casesQ.data, payersQ.data, groupsQ.data, providerId],
  );
  const factById = useMemo(() => new Map((factsQ.data ?? []).map((f) => [f.id, f])), [factsQ.data]);

  const submit = () => {
    if (!groupDraft || !payerDraft || !stateDraft) {
      setError("Group, payer, and state are required.");
      return;
    }
    createFact.mutate(
      {
        providerId,
        groupId: groupDraft,
        payerId: payerDraft,
        state: stateDraft,
        effectiveDate: dateDraft || null,
        payerIssuedId: pinDraft.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success("Enrollment fact recorded — no case was created.");
          setAdding(false);
          setGroupDraft("");
          setPayerDraft("");
          setStateDraft("");
          setDateDraft("");
          setPinDraft("");
          setError(null);
        },
        onError: (e) =>
          setError(e instanceof Error ? e.message : "Could not record the enrollment."),
      },
    );
  };

  return (
    <>
      <RecordSectionCard
        id="enrollments"
        title="Enrollments"
        action={
          canWrite ? (
            <AddButton
              label="Add enrollment"
              onClick={() => setAdding(true)}
              disabled={myGroups.length === 0}
            />
          ) : undefined
        }
      >
        <div className="space-y-3">
          <p className="rounded-md border border-[#E8E5E0] bg-[#FAFAF9] p-2 text-[12.5px] text-muted-foreground">
            {ENROLLMENT_GUARD_TEXT}
          </p>
          {myRows.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No enrollments yet — approved cases appear here automatically; record a fact only for
              pre-existing enrollments.
            </p>
          ) : (
            <ul className="divide-y divide-[#F0EEE9] rounded-md border border-[#E8E5E0]">
              {myRows.map((row) => {
                const fact = row.factId ? (factById.get(row.factId) ?? null) : null;
                return (
                  <li
                    key={row.key}
                    className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]"
                  >
                    <span className="font-medium">{row.payerName}</span>
                    <span>{row.state}</span>
                    <span className="text-muted-foreground">under {row.groupName}</span>
                    {row.effectiveDate ? (
                      <span className="text-muted-foreground">
                        since {fmtDate(row.effectiveDate)}
                      </span>
                    ) : null}
                    {row.payerIssuedId ? (
                      <span className="rounded-[4px] bg-[#F4F2EF] px-1.5 py-0.5 text-[11.5px] text-foreground">
                        {row.pinLabel}: {row.payerIssuedId}
                      </span>
                    ) : null}
                    {row.source === "case" ? (
                      <>
                        <StatusPill status="green" label="Active" />
                        {/* Derived from the approved case — the case IS the
                            record; edits/corrections happen there and re-derive. */}
                        <span className="rounded-[4px] bg-[#F4F2EF] px-1.5 py-0.5 text-[11.5px] text-muted-foreground">
                          From case
                        </span>
                      </>
                    ) : row.live ? (
                      // Standard status vocabulary: an in-force enrollment is
                      // "Active" whichever source it derives from ("Live" was a
                      // drift — user handoff 2026-07-21).
                      <StatusPill status="green" label="Active" />
                    ) : (
                      <StatusPill
                        status="neutral"
                        label={`Expired ${fmtDate(row.expiredAt ?? "")}`}
                      />
                    )}
                    {row.source === "case" && row.caseId ? (
                      <Link
                        to="/cases/$id"
                        params={{ id: row.caseId }}
                        className="ml-auto text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
                      >
                        Open case
                      </Link>
                    ) : null}
                    {row.source === "fact" && canWrite && fact ? (
                      <button
                        type="button"
                        className="ml-auto text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        onClick={() => setEditingId(fact)}
                      >
                        {row.payerIssuedId ? "Edit ID" : "Add ID"}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </RecordSectionCard>

      {adding ? (
        <Dialog open onOpenChange={(o) => !o && setAdding(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Record an enrollment fact</DialogTitle>
              <DialogDescription>{ENROLLMENT_GUARD_TEXT}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="fact-group">Group (whose contract)</Label>
                <Select value={groupDraft} onValueChange={setGroupDraft}>
                  <SelectTrigger id="fact-group" aria-label="Enrollment group">
                    <SelectValue placeholder="Pick a group" />
                  </SelectTrigger>
                  <SelectContent>
                    {myGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fact-payer">Payer</Label>
                <Select value={payerDraft} onValueChange={setPayerDraft}>
                  <SelectTrigger id="fact-payer" aria-label="Enrollment payer">
                    <SelectValue placeholder="Pick a payer" />
                  </SelectTrigger>
                  <SelectContent>
                    {(payersQ.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fact-state">State</Label>
                <StateSelect
                  id="fact-state"
                  value={stateDraft}
                  onChange={setStateDraft}
                  allowNone={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Effective date (optional)</Label>
                <DatePicker value={dateDraft} onChange={setDateDraft} ariaLabel="Effective date" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fact-pin">{draftPinLabel} (optional)</Label>
                <Input
                  id="fact-pin"
                  value={pinDraft}
                  onChange={(e) => setPinDraft(e.target.value)}
                  placeholder="As issued by the payer for this enrollment"
                  className="h-9"
                />
              </div>
              {error ? (
                <p role="alert" className="text-[12px] text-[#B91C1C]">
                  {error}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button
                className="bg-[#1B4D3E] hover:bg-[#163F33]"
                disabled={createFact.isPending}
                onClick={submit}
              >
                Record fact
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {editingId ? (
        <FactIdentifierDialog
          fact={editingId}
          label={
            resolveIdentifierConfig(
              (payersQ.data ?? []).find((p) => p.id === editingId.payerId) ?? null,
            ).individualLabel
          }
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </>
  );
}

// Set/clear the payer-issued ID on an existing fact — approval letters often
// arrive after the fact was recorded, and expired rows stay correctable
// (history should be accurate). Audited via the service.
function FactIdentifierDialog({
  fact,
  label,
  onClose,
}: {
  fact: EnrollmentFact;
  label: string;
  onClose: () => void;
}) {
  const setIdMut = useSetEnrollmentFactIdentifier();
  const [value, setValue] = useState(fact.payerIssuedId ?? "");
  const save = () => {
    setIdMut.mutate(
      { id: fact.id, payerIssuedId: value.trim() || null },
      {
        onSuccess: () => {
          toast.success(value.trim() ? `${label} saved` : `${label} cleared`);
          onClose();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the ID"),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            The identifier the payer issued for this enrollment ({fact.state}). Leave blank to clear
            it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="fact-pin-edit">{label}</Label>
          <Input
            id="fact-pin-edit"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="As issued by the payer"
            className="h-9"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={setIdMut.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] hover:bg-[#163F33]"
            disabled={setIdMut.isPending}
            onClick={save}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
