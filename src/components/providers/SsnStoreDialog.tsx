// E4.4 F4.4.4 — internal secure entry modal. Writer roles (specialist|admin;
// the RPC re-checks). For legacy paper intake: staff enter the full SSN here and
// it encrypts immediately on save into the vault, displaying the mask on
// success. The value NEVER enters any other field — this modal is a dedicated,
// single-purpose surface, and its input is cleared whenever the dialog closes.
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { useStoreSsn } from "@/hooks/useSsnVault";
import { formatFullSsn } from "@/lib/ssnMask";

export function SsnStoreDialog({
  providerId,
  providerName,
  hasSsn,
  open,
  onOpenChange,
}: {
  providerId: string;
  providerName: string;
  hasSsn: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const store = useStoreSsn(providerId);
  const [digits, setDigits] = useState("");

  // The entered value never survives the dialog.
  useEffect(() => {
    if (!open) {
      setDigits("");
      store.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const complete = digits.length === 9;
  async function onSave() {
    if (!complete) return;
    try {
      const res = await store.mutateAsync(digits);
      toast.success(`SSN saved securely (${res.mask})`);
      onOpenChange(false);
    } catch {
      // Surfaced via store.error below; never log the value.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{hasSsn ? "Update full SSN" : "Enter full SSN securely"}</DialogTitle>
          <DialogDescription>
            {providerName}'s full SSN is encrypted immediately on save and stored only in the secure
            vault. You won't see it again after saving — only the masked last four.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="ssn-store-input">Social Security Number</Label>
          <Input
            id="ssn-store-input"
            value={formatFullSsn(digits)}
            onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 9))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="123-45-6789"
            className="font-mono tracking-widest"
            aria-describedby="ssn-store-help"
            autoFocus
          />
          <p id="ssn-store-help" className="text-[12px] text-muted-foreground">
            Enter all nine digits. Encrypted on save; the last four are all that's ever displayed.
          </p>
          {store.error ? (
            <div
              role="alert"
              className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]"
            >
              {(store.error as Error).message}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={!complete || store.isPending}
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          >
            {store.isPending ? "Saving…" : "Save securely"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
