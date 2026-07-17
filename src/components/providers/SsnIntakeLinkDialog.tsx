// E4.4 F4.4.4 — secure SSN intake link (E0.5 capture-link pattern). A writer
// issues a single-use, expiring, provider-bound link to the provider or an
// authorized org rep, who enters the SSN themselves — keeping internal staff out
// of the loop. Stage 0 precedent (no send infra): the dialog surfaces a
// copy-able link the operator sends. The raw token is shown ONCE here and never
// stored.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy } from "lucide-react";
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
import { isValidEmail } from "@/lib/contactValidation";
import { fmtDateTime } from "@/lib/format";
import { useIssueSsnIntakeLink } from "@/hooks/useSsnVault";
import type { IssuedSsnIntakeLink } from "@/types";

function intakeUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/ssn-intake/${token}`;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy — select and copy manually");
  }
}

export function SsnIntakeLinkDialog({
  providerId,
  providerName,
  open,
  onOpenChange,
}: {
  providerId: string;
  providerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const issue = useIssueSsnIntakeLink();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<IssuedSsnIntakeLink | null>(null);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setName("");
      setIssued(null);
      issue.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canIssue = isValidEmail(email.trim()) && !issue.isPending;
  async function onIssue() {
    if (!canIssue) return;
    try {
      const result = await issue.mutateAsync({
        providerId,
        recipientEmail: email.trim(),
        recipientName: name.trim() || undefined,
      });
      setIssued(result);
      toast.success("Secure intake link created");
    } catch {
      // Surfaced via issue.error below.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send a secure SSN intake link</DialogTitle>
          <DialogDescription>
            {providerName} or an authorized contact can enter the SSN themselves on a secure page.
            The link is single-use, expires in 72 hours, and only ever accepts this provider's SSN.
          </DialogDescription>
        </DialogHeader>

        {issued ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[13px] text-[#166534]">
              <CheckCircle2 className="h-4 w-4" />
              Link ready — copy and send it. It won't be shown again.
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ssn-intake-link">Secure link</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="ssn-intake-link"
                  readOnly
                  value={intakeUrl(issued.token)}
                  className="font-mono text-[12px]"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy secure link"
                  onClick={() => copy(intakeUrl(issued.token), "Link")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">
              For {issued.recipientEmail} · expires {fmtDateTime(issued.expiresAt)}.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ssn-intake-email">Recipient email</Label>
              <Input
                id="ssn-intake-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="provider@example.com"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ssn-intake-name">Recipient name (optional)</Label>
              <Input
                id="ssn-intake-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="For the message only"
              />
            </div>
            {issue.error ? (
              <div
                role="alert"
                className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]"
              >
                {(issue.error as Error).message}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {issued ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={onIssue}
                disabled={!canIssue}
                className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
              >
                {issue.isPending ? "Creating…" : "Create link"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
