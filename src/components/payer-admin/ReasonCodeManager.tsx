// E4.2 F4.2.3 — reason-code vocabulary management. Seeded defaults (org_id NULL,
// global) are non-deletable AND cannot be deactivated by an org; org-added codes
// can be added and deactivated (never deleted), so historical denial rows keep
// resolving inactive labels. Deactivated codes disappear from new-entry
// dropdowns (the dropdown reader filters active) but still render here and on
// history.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/StatusPill";
import {
  useAllDenialReasonCodes,
  useCreateDenialReasonCode,
  useSetDenialReasonCodeActive,
} from "@/hooks/useReasonCodes";

export function ReasonCodeManager() {
  const codesQ = useAllDenialReasonCodes();
  const createMut = useCreateDenialReasonCode();
  const toggleMut = useSetDenialReasonCodeActive();
  const [label, setLabel] = useState("");

  const add = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    createMut.mutate(
      { label: trimmed },
      {
        onSuccess: () => {
          toast.success("Reason code added.");
          setLabel("");
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not add the reason code."),
      },
    );
  };

  const toggle = (id: string, active: boolean) => {
    toggleMut.mutate(
      { id, active },
      {
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not update the reason code."),
      },
    );
  };

  if (!codesQ.data) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-reason">Add an organization reason code</Label>
          <Input
            id="new-reason"
            value={label}
            placeholder="e.g. Roster mismatch"
            className="w-72"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
        </div>
        <Button
          className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          disabled={!label.trim() || createMut.isPending}
          onClick={add}
        >
          Add code
        </Button>
      </div>

      <div className="rounded-md border border-[#E8E5E0] overflow-hidden bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
              {["Label", "Code", "Type", "Status", ""].map((h, i) => (
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
            {codesQ.data.map((code) => {
              const isSystem = code.orgId === null;
              return (
                <tr key={code.id} className="border-b border-[#E8E5E0] last:border-0">
                  <td className="px-3 h-10 align-middle font-medium">{code.label}</td>
                  <td className="px-3 h-10 align-middle text-muted-foreground font-mono text-[12px]">
                    {code.code}
                  </td>
                  <td className="px-3 h-10 align-middle">
                    <StatusPill
                      status={isSystem ? "brand" : "neutral"}
                      label={isSystem ? "Default" : "Org"}
                    />
                  </td>
                  <td className="px-3 h-10 align-middle">
                    <StatusPill
                      status={code.active ? "green" : "neutral"}
                      label={code.active ? "Active" : "Inactive"}
                    />
                  </td>
                  <td className="px-3 h-10 align-middle text-right">
                    {isSystem ? (
                      <span className="text-[12px] text-muted-foreground">Managed centrally</span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px] px-2"
                        disabled={toggleMut.isPending}
                        onClick={() => toggle(code.id, !code.active)}
                      >
                        {code.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
