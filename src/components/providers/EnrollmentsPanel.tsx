// E6.4 F6.4.4 — enrollment-fact capture on the provider record. Facts record
// "already enrolled with this payer UNDER THIS GROUP'S CONTRACT" (migration
// truth) — they count the payer Active on the board, suppress the generation
// candidate, and NEVER create a case. Prior-employer status does not belong
// here: a new hire gets the full path regardless (the guard text below is the
// epic's labeling requirement). Expire is a FLIP (audited) that immediately
// re-opens the candidate in the group's buffer.
import { useMemo, useState } from "react";
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
import {
  useCreateEnrollmentFact,
  useEnrollmentFacts,
  useExpireEnrollmentFact,
} from "@/hooks/useEnrollmentFacts";
import { useProviderGroupAssignments } from "@/hooks/useProviders";
import { useProviderGroups } from "@/hooks/useLookups";
import { usePayers } from "@/hooks/useAdmin";
import { fmtDate } from "@/lib/format";

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
  const groupAssignQ = useProviderGroupAssignments();
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();
  const createFact = useCreateEnrollmentFact();
  const expireFact = useExpireEnrollmentFact();

  const [adding, setAdding] = useState(false);
  const [groupDraft, setGroupDraft] = useState("");
  const [payerDraft, setPayerDraft] = useState("");
  const [stateDraft, setStateDraft] = useState("");
  const [dateDraft, setDateDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expiring, setExpiring] = useState<string | null>(null);

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

  const myFacts = useMemo(
    () =>
      (factsQ.data ?? [])
        .filter((f) => f.providerId === providerId)
        .map((f) => ({
          ...f,
          payerName: (payersQ.data ?? []).find((p) => p.id === f.payerId)?.name ?? "—",
          groupName: (groupsQ.data ?? []).find((g) => g.id === f.groupId)?.name ?? "—",
        }))
        .sort((a, b) => a.payerName.localeCompare(b.payerName) || a.state.localeCompare(b.state)),
    [factsQ.data, payersQ.data, groupsQ.data, providerId],
  );

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
      },
      {
        onSuccess: () => {
          toast.success("Enrollment fact recorded — no case was created.");
          setAdding(false);
          setGroupDraft("");
          setPayerDraft("");
          setStateDraft("");
          setDateDraft("");
          setError(null);
        },
        onError: (e) =>
          setError(e instanceof Error ? e.message : "Could not record the enrollment."),
      },
    );
  };

  return (
    <div className="space-y-3">
      <p className="rounded-md border border-[#E8E5E0] bg-[#FAFAF9] p-2 text-[12.5px] text-muted-foreground">
        {ENROLLMENT_GUARD_TEXT}
      </p>
      {canWrite ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[12px]"
          onClick={() => setAdding(true)}
          disabled={myGroups.length === 0}
        >
          Add enrollment
        </Button>
      ) : null}
      {myFacts.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No enrollment facts recorded.</p>
      ) : (
        <ul className="divide-y divide-[#F0EEE9] rounded-md border border-[#E8E5E0]">
          {myFacts.map((f) => {
            const live = f.expiredAt === null;
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                <span className="font-medium">{f.payerName}</span>
                <span>{f.state}</span>
                <span className="text-muted-foreground">under {f.groupName}</span>
                {f.effectiveDate ? (
                  <span className="text-muted-foreground">since {fmtDate(f.effectiveDate)}</span>
                ) : null}
                {live ? (
                  <StatusPill status="green" label="Live" />
                ) : (
                  <StatusPill status="neutral" label={`Expired ${fmtDate(f.expiredAt ?? "")}`} />
                )}
                {canWrite && live ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto h-7 text-[12px]"
                    onClick={() => setExpiring(f.id)}
                  >
                    Expire
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

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
                <Label>State</Label>
                <StateSelect value={stateDraft} onChange={setStateDraft} allowNone={false} />
              </div>
              <div className="space-y-1.5">
                <Label>Effective date (optional)</Label>
                <DatePicker value={dateDraft} onChange={setDateDraft} ariaLabel="Effective date" />
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

      {expiring ? (
        <Dialog open onOpenChange={(o) => !o && setExpiring(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Expire this enrollment?</DialogTitle>
              <DialogDescription>
                Expiry is a flip, never a delete. The combination immediately re-opens as a
                generation candidate in the group&apos;s buffer.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setExpiring(null)}>
                Cancel
              </Button>
              <Button
                className="bg-[#1B4D3E] hover:bg-[#163F33]"
                disabled={expireFact.isPending}
                onClick={() =>
                  expireFact.mutate(expiring, {
                    onSuccess: () => {
                      toast.success("Enrollment expired — the candidate is back in the buffer.");
                      setExpiring(null);
                    },
                    onError: (e) =>
                      toast.error(e instanceof Error ? e.message : "Could not expire the fact."),
                  })
                }
              >
                Expire enrollment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
