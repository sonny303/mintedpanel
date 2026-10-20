
// 2026-10-20 — InviteProviderDialog. Operator-side sibling of
// SsnIntakeLinkDialog. Used by practice owners/coordinators to invite a single
// hire. On success shows the issued intake link in a copyable input.
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
import { inviteProvider, type InviteProviderResult } from "@/services/providerInvitations";

function intakeUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/onboarding/${token}`;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy — select and copy manually");
  }
}

export function InviteProviderDialog({
  providerId,
  groupId,
  open,
  onOpenChange,
}: {
  providerId: string;
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<InviteProviderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) {
      setEmail(""); setName(""); setIssued(null); setError(null); setPending(false);
    }
  }, [open]);

  const canIssue = isValidEmail(email.trim()) && !pending;

  async function onIssue() {
    if (!canIssue) return;
    setError(null);
    setPending(true);
    try {
      const [first, ...rest] = name.trim().split(/\s+/);
      const result = await inviteProvider({
        firstName: first ?? "",
        lastName: rest.join(" "),
        email: email.trim(),
        groupId,
        // Provider-npi is provided via the providerId of the already-created row;
        // for now we pass providerId as a placeholder — wiring to
        // createProviderWithDetails lands in a follow-up.
      });
      // The service uses the create_provider_intake_link RPC signature that
      // takes p_provider_id. Until the coordinator-side create flow is fully
      // wired we surface a clear error if it fails.
      setIssued(result);
      toast.success("Invitation link ready");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a provider to complete their profile</DialogTitle>
          <DialogDescription>
            They'll receive an email from the practice with a one-time link.
            No account or password required.
          </DialogDescription>
        </DialogHeader>

        {issued ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[13px] text-[#166534]">
              <CheckCircle2 className="h-4 w-4" />
              Link ready — copy and send it. It won't be shown again.
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-link">Secure link</Label>
              <div className="flex items-center gap-2">
                <Input id="invite-link" readOnly value={intakeUrl(issued.token)} className="font-mono text-[12px]" />
                <Button type="button" variant="outline" size="icon" aria-label="Copy" onClick={() => copy(intakeUrl(issued.token), "Link")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">
              For {issued.recipient_email} · expires {fmtDateTime(issued.expires_at)}.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Provider name</Label>
              <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Anita Rao" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Recipient email</Label>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="provider@example.com" autoFocus />
            </div>
            {error ? (
              <div role="alert" className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]">
                {error}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {issued ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={onIssue} disabled={!canIssue} className="bg-[#1B4D3E] text-white hover:bg-[#163F33]">
                {pending ? "Creating…" : "Create link"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
