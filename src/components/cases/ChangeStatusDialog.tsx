// Credentialing status change dialog for a case. Enforces per-status
// required_fields and shows a warning when moving to Active without an
// executed contract.
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import type { StatusConfig } from "@/types";

interface FieldDescriptor {
  key: string;
  type?: string;
  label?: string;
  options?: string[];
}

function normalizeRequiredField(f: unknown): FieldDescriptor {
  if (typeof f === "string") return { key: f };
  if (f && typeof f === "object") {
    const o = f as Record<string, unknown>;
    return {
      key: typeof o.key === "string" ? o.key : String(o.key ?? ""),
      type: typeof o.type === "string" ? o.type : undefined,
      label: typeof o.label === "string" ? o.label : undefined,
      options: Array.isArray(o.options)
        ? o.options.filter((x): x is string => typeof x === "string")
        : undefined,
    };
  }
  return { key: "" };
}

export interface ChangeStatusDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  statuses: StatusConfig[];
  currentStatusId: string | null;
  payerName: string;
  state: string;
  contractIsExecuted: boolean;
  saving: boolean;
  onSave: (args: {
    statusId: string;
    metadata: Record<string, unknown>;
    withoutContractWarning: boolean;
  }) => void;
}

export function ChangeStatusDialog({
  open,
  onOpenChange,
  statuses,
  currentStatusId,
  payerName,
  state,
  contractIsExecuted,
  saving,
  onSave,
}: ChangeStatusDialogProps) {
  const [targetId, setTargetId] = useState<string>("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [warningAck, setWarningAck] = useState(false);

  const target = statuses.find((s) => s.id === targetId);
  const isActiveTarget = (target?.label ?? "").toLowerCase() === "active";
  const needsContractWarning = isActiveTarget && !contractIsExecuted;

  const requiredFields = ((target?.requiredFields ?? []) as unknown[]).map(normalizeRequiredField);
  const missing = requiredFields.some((f) => !(fieldValues[f.key] ?? "").trim());
  const canSave = Boolean(target) && !missing && (!needsContractWarning || warningAck);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setTargetId("");
          setFieldValues({});
          setWarningAck(false);
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change credentialing status</DialogTitle>
          <DialogDescription>
            Pick the new status. Required fields must be filled before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              New status
            </Label>
            <Select
              value={targetId}
              onValueChange={(v) => {
                setTargetId(v);
                setFieldValues({});
                setWarningAck(false);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id} disabled={s.id === currentStatusId}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {requiredFields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {f.label ?? f.key.replace(/_/g, " ")}
              </Label>
              {f.type === "select" && f.options ? (
                <Select
                  value={fieldValues[f.key] ?? ""}
                  onValueChange={(v) => setFieldValues((prev) => ({ ...prev, [f.key]: v }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={f.type === "date" || /date|effective/i.test(f.key) ? "date" : "text"}
                  value={fieldValues[f.key] ?? ""}
                  onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="h-9"
                />
              )}
            </div>
          ))}

          {needsContractWarning ? (
            <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-md p-3 space-y-2">
              <div className="flex items-start gap-2 text-[#92400E]">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p className="text-[13px] font-medium">
                  No executed contract for {payerName} in {state}. Claims will deny until the
                  contract is executed. Continue?
                </p>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-[#92400E] cursor-pointer">
                <input
                  type="checkbox"
                  checked={warningAck}
                  onChange={(e) => setWarningAck(e.target.checked)}
                  className="rounded border-[#FDE68A]"
                />
                I understand and want to proceed.
              </label>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={!canSave || saving}
            onClick={() => {
              if (!target) return;
              const metadata: Record<string, unknown> = {};
              requiredFields.forEach((f) => {
                metadata[f.key] = fieldValues[f.key];
              });
              onSave({
                statusId: target.id,
                metadata,
                withoutContractWarning: needsContractWarning,
              });
            }}
          >
            {saving ? "Saving…" : "Save status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
