// E4.2 F4.2.1 — per-payer resolution-identifier config. Sets the label of the
// payer-issued INDIVIDUAL enrollment identifier (e.g. Aetna "Provider PIN") and
// whether one is expected at approval. Consumed by the E4.0 F4.0.3 approval step
// through the payerResolutionIdentifier seam. A blank label = unconfigured →
// generic "Payer-issued ID" fallback.
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
import { useUpdatePayer } from "@/hooks/useAdmin";
import type { Payer } from "@/types";

interface Props {
  payer: Payer;
  onClose: () => void;
}

export function PayerResolutionIdDialog({ payer, onClose }: Props) {
  const update = useUpdatePayer(payer.id);
  const [label, setLabel] = useState(payer.resolutionIdLabel ?? "");
  const [expected, setExpected] = useState(payer.resolutionIdExpected ?? true);

  const save = () => {
    update.mutate(
      {
        resolutionIdLabel: label.trim() ? label.trim() : null,
        resolutionIdExpected: expected,
      },
      {
        onSuccess: () => {
          toast.success("Resolution identifier saved.");
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
              What this payer calls its individual provider ID. Leave blank for the generic
              &ldquo;Payer-issued ID&rdquo; field.
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
            disabled={update.isPending}
            onClick={save}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
