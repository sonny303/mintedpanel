import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { normalizePortalKey } from "@/lib/tokenFormat";
import { listEffectivePortalMapResolutions } from "@/services/portalFieldMaps";
import type { Contract, ContractingStatusLabel } from "@/types";

export const CANONICAL_CONTRACTING_STATUSES: ContractingStatusLabel[] = [
  "Not Started",
  "Application Submitted",
  "In Progress (Contract Signed)",
  "In-Network",
  "Denied",
  "Denied - Appealed",
  "Denied - Reapplied",
  "Out of Network",
];

interface ContractDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  contract: Contract | null;
  groupId: string;
  payerId: string;
  state: string;
  groupName?: string;
  payerName?: string;
}

export function ContractDetailDrawer({
  open,
  onClose,
  contract,
  groupId,
  payerId,
  state,
  groupName,
  payerName,
}: ContractDetailDrawerProps) {
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

  const [statusId, setStatusId] = useState<string>("");
  const [specialty, setSpecialty] = useState<string>("");
  const [tentativeDate, setTentativeDate] = useState<string>("");
  const [effectiveDate, setEffectiveDate] = useState<string>("");
  const [expirationDate, setExpirationDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  useEffect(() => {
    if (contract) {
      setStatusId(contract.contractingStatusId ?? "");
      setSpecialty(contract.specialty ?? "");
      setTentativeDate(contract.tentativeEffectiveDate ?? "");
      setEffectiveDate(contract.effectiveDate ?? "");
      setExpirationDate(contract.expirationDate ?? "");
      setNotes(contract.notes ?? "");
    } else {
      // Find "Not Started" or empty
      const notStarted = (statusesQ.data ?? []).find((s) => s.label === "Not Started");
      setStatusId(notStarted?.id ?? "");
      setSpecialty("");
      setTentativeDate("");
      setEffectiveDate("");
      setExpirationDate("");
      setNotes("");
    }
  }, [contract, open, statusesQ.data]);

  async function handleSave() {
    if (!groupId || !payerId || !state) {
      toast.error("Group, payer, and state are required.");
      return;
    }

    try {
      await upsertM.mutateAsync({
        groupId,
        payerId,
        state: state.toUpperCase(),
        contractingStatusId: statusId || null,
        specialty: specialty.trim() || null,
        tentativeEffectiveDate: tentativeDate.trim() || null,
        effectiveDate: effectiveDate.trim() || null,
        expirationDate: expirationDate.trim() || null,
        notes: notes.trim() || null,
      });

      toast.success("Contract details updated successfully.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update contract.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {payerName ?? "Payer"} — {state}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Group contract record for{" "}
            <span className="font-medium text-foreground">{groupName ?? "Group"}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <ContractSopAssignmentPanel
            contract={contract}
            groupId={groupId}
            payerId={payerId}
            state={state}
            orgId={activeOrgId}
            portalConfigurationForKey={portalConfigurationForKey}
            portalResolverState={portalResolverState}
          />

          {/* Status Field */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Contracting Status</Label>
            <Select value={statusId} onValueChange={setStatusId}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {(statusesQ.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: s.color || "#9CA3AF" }}
                      />
                      <span>{s.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Specialty */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Specialty{" "}
              <span className="text-muted-foreground font-normal">
                (Optional / Multi-specialty)
              </span>
            </Label>
            <Input
              placeholder="e.g. Physical Therapy, Multi-Specialty"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
            />
          </div>

          {/* Dates: 3 columns */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Tentative Date</Label>
              <Input
                type="date"
                value={tentativeDate}
                onChange={(e) => setTentativeDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Effective Date</Label>
              <Input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Expiration Date</Label>
              <Input
                type="date"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
              />
            </div>
          </div>

          {/* Notes & Dependencies */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Notes & Cross-Payer Dependencies</Label>
            <Textarea
              rows={3}
              placeholder="e.g. Humana effective only after Medicare enrollment is complete to load contract..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={upsertM.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={upsertM.isPending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {upsertM.isPending ? "Saving..." : "Save Contract"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
