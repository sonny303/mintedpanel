// Insurance policies list + edit dialog for a provider group.
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { fmtDate } from "@/lib/format";
import {
  useCreateGroupInsurancePolicy,
  useGroupInsurancePolicies,
  useUpdateGroupInsurancePolicy,
} from "@/hooks/useOrgSettings";
import type { InsurancePolicy, InsurancePolicyInput, InsuranceType } from "@/services/orgSettings";

function insuranceTypeLabel(t: InsuranceType): string {
  return t === "professional_liability" ? "Professional Liability" : "General Liability";
}

function policyStatus(start: string, end: string): { label: string; status: StatusColor } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const s = new Date(start);
  const e = new Date(end);
  if (today < s) {
    return { label: "Future", status: "neutral" as const };
  }
  if (today > e) {
    return { label: "Expired", status: "red" as const };
  }
  return { label: "Active", status: "green" as const };
}

export function InsurancePanel({ groupId, canEdit }: { groupId: string; canEdit: boolean }) {
  const policiesQ = useGroupInsurancePolicies(groupId);
  const [modal, setModal] = useState<{ policy: InsurancePolicy | null } | null>(null);

  return (
    <div className="border border-[#E8E5E0] rounded-md bg-white">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#E8E5E0]">
        <div className="text-[13px] font-semibold">Insurance Policies</div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setModal({ policy: null })}
            className="bg-[#1B4D3E] hover:bg-[#163F33] text-white h-7 text-[11px] px-2"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Policy
          </Button>
        )}
      </div>
      {policiesQ.isLoading ? (
        <table className="w-full">
          <tbody>
            <TableSkeletonRows rows={6} cols={6} />
          </tbody>
        </table>
      ) : policiesQ.isError ? (
        <div className="p-6 text-center">
          <EmptyState
            message="Failed to load insurance policies"
            action={
              <Button variant="outline" size="sm" onClick={() => policiesQ.refetch()}>
                Retry
              </Button>
            }
          />
        </div>
      ) : (policiesQ.data ?? []).length === 0 ? (
        <div className="p-4">
          <EmptyState
            message="No insurance policies yet"
            description="Add a policy to track group coverage"
          />
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
              {["Type", "Insurer", "Policy #", "Start Date", "End Date", "Status"].map((h, i) => (
                <th
                  key={i}
                  className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(policiesQ.data ?? []).map((p) => {
              const status = policyStatus(p.policyStartDate, p.policyEndDate);
              return (
                <tr
                  key={p.id}
                  onClick={() => canEdit && setModal({ policy: p })}
                  className={`border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9] ${
                    canEdit ? "cursor-pointer" : ""
                  }`}
                >
                  <td className="px-3 h-10 align-middle">{insuranceTypeLabel(p.insuranceType)}</td>
                  <td className="px-3 h-10 align-middle font-medium">{p.insurerName}</td>
                  <td className="px-3 h-10 align-middle text-muted-foreground">{p.policyNumber}</td>
                  <td className="px-3 h-10 align-middle text-muted-foreground">
                    {fmtDate(p.policyStartDate)}
                  </td>
                  <td className="px-3 h-10 align-middle text-muted-foreground">
                    {fmtDate(p.policyEndDate)}
                  </td>
                  <td className="px-3 h-10 align-middle">
                    <StatusPill status={status.status} label={status.label} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {modal ? (
        <InsurancePolicyEditModal
          groupId={groupId}
          policy={modal.policy}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

function InsurancePolicyEditModal({
  groupId,
  policy,
  onClose,
}: {
  groupId: string;
  policy: InsurancePolicy | null;
  onClose: () => void;
}) {
  const [insuranceType, setInsuranceType] = useState<InsuranceType>(
    policy?.insuranceType ?? "professional_liability",
  );
  const [insurerName, setInsurerName] = useState(policy?.insurerName ?? "");
  const [policyNumber, setPolicyNumber] = useState(policy?.policyNumber ?? "");
  const [startDate, setStartDate] = useState(policy?.policyStartDate ?? "");
  const [endDate, setEndDate] = useState(policy?.policyEndDate ?? "");
  const [notes, setNotes] = useState(policy?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const createMut = useCreateGroupInsurancePolicy(groupId);
  const updateMut = useUpdateGroupInsurancePolicy(policy?.id ?? "", groupId);
  const pending = createMut.isPending || updateMut.isPending;

  const handleSave = () => {
    setError(null);
    const input: InsurancePolicyInput = {
      groupId,
      insuranceType,
      insurerName,
      policyNumber,
      policyStartDate: startDate,
      policyEndDate: endDate,
      notes: notes.trim() || null,
    };
    const onErr = (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.error(msg);
    };
    if (policy) {
      updateMut.mutate(input, {
        onSuccess: () => {
          toast.success("Policy updated");
          onClose();
        },
        onError: onErr,
      });
    } else {
      createMut.mutate(input, {
        onSuccess: () => {
          toast.success("Policy created");
          onClose();
        },
        onError: onErr,
      });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{policy ? "Edit policy" : "Add policy"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-[12px]">Insurance Type</Label>
            <Select
              value={insuranceType}
              onValueChange={(v) => setInsuranceType(v as InsuranceType)}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="professional_liability">Professional Liability</SelectItem>
                <SelectItem value="general_liability">General Liability</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12px]">Insurer Name</Label>
            <Input
              value={insurerName}
              onChange={(e) => setInsurerName(e.target.value)}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-[12px]">Policy #</Label>
            <Input
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px]">Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-[12px]">End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9"
              />
            </div>
          </div>
          <div>
            <Label className="text-[12px]">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          {error ? (
            <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending}
            className="bg-[#1B4D3E] hover:bg-[#163F33] text-white"
          >
            {pending ? "Saving…" : policy ? "Save changes" : "Create policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
