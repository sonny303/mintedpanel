// E4.2 F4.2.1 (hardened by the payer-governance PR) — the org's
// resolution-identifier config for one payer. Writes org_payer_settings (the
// org × payer grain), NEVER the payers row: most catalog payers are global
// (org_id NULL) and a payers write would be rejected. Consumed by the E4.0
// F4.0.3 approval step through the payerResolutionIdentifier seam: org setting
// → Minted-curated global label → generic "Payer-issued ID".
import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { useUpsertOrgPayerSetting } from "@/hooks/useOrgPayerSettings";
import type { OrgPayerSetting, Payer } from "@/types";

interface Props {
  payer: Payer;
  /** The org's existing setting row for this payer (null = unconfigured). */
  setting: OrgPayerSetting | null;
  onClose: () => void;
}

export function PayerResolutionIdDialog({ payer, setting, onClose }: Props) {
  const upsert = useUpsertOrgPayerSetting();
  const [label, setLabel] = useState(setting?.resolutionIdLabel ?? "");
  const [expected, setExpected] = useState(
    setting?.resolutionIdExpected ?? payer.resolutionIdExpected ?? true,
  );

  const mintedLabel = payer.resolutionIdLabel?.trim();
  const fallbackNote = mintedLabel
    ? `Leave blank to use the Minted default for this payer (“${mintedLabel}”).`
    : "Leave blank for the generic “Payer-issued ID” field.";

  const save = () => {
    upsert.mutate(
      {
        payerId: payer.id,
        resolutionIdLabel: label.trim() ? label.trim() : null,
        resolutionIdExpected: expected,
      },
      {
        onSuccess: () => {
          toast.success("Resolution identifier saved for this organization.");
          onClose();
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not save the identifier config."),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolution identifier — {payer.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="res-id-label">Identifier label</Label>
            <Input
              id="res-id-label"
              value={label}
              placeholder="e.g. Provider PIN"
              onChange={(e) => setLabel(e.target.value)}
            />
            <p className="text-[12px] text-muted-foreground">
              What this payer calls its individual provider ID, for this organization.{" "}
              {fallbackNote}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="res-id-expected">Expected at approval</Label>
              <p className="text-[12px] text-muted-foreground">
                Whether this payer issues an ID when a provider is approved.
              </p>
            </div>
            <Switch id="res-id-expected" checked={expected} onCheckedChange={setExpected} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            disabled={upsert.isPending}
            onClick={save}
          >
            {upsert.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
