// Provider onboarding slice 1: a staff writer invites a provider (canvas board
// 1's modal). The server creates the onboarding provider and emails the link;
// a duplicate comes back as the existing provider with a Resend offer.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProviderGroups } from "@/hooks/useLookups";
import { useCreateProviderInvite, useResendProviderInvite } from "@/hooks/useProviderInvites";
import type { InviteDelivery } from "@/services/providerInvites";

const NONE = "__none__";

function notifyDelivery(delivery: InviteDelivery, sentMessage: string) {
  if (delivery === "sent") toast.success(sentMessage);
  else if (delivery === "sandbox")
    toast.warning("Invite saved. Email is in sandbox mode, so nothing was delivered.");
  else toast.warning("Invite saved, but the email didn't send. Resend it in 10 minutes.");
}

export function InviteProviderDialog({ onClose }: { onClose: () => void }) {
  const groups = useProviderGroups();
  const invite = useCreateProviderInvite();
  const resend = useResendProviderInvite();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [groupId, setGroupId] = useState(NONE);
  const [npi, setNpi] = useState("");
  const [startDate, setStartDate] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = firstName.trim() && lastName.trim() && email.trim() && groupId !== NONE;

  async function onSend() {
    setError(null);
    try {
      const result = await invite.mutateAsync({
        firstName,
        lastName,
        email,
        groupId,
        npi: npi.trim() || undefined,
        startDate: startDate || undefined,
      });
      if (result.outcome === "already_exists") {
        setExistingId(result.providerId);
        return;
      }
      notifyDelivery(result.delivery, `Invite sent to ${email.trim()}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invite couldn't be sent.");
    }
  }

  async function onResend() {
    if (!existingId) return;
    setError(null);
    try {
      const { delivery, email: sentTo } = await resend.mutateAsync(existingId);
      notifyDelivery(delivery, `Invite sent to ${sentTo}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invite couldn't be resent.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a provider</DialogTitle>
          <DialogDescription>
            They get an email from the practice and verify with a code sent to that address.
          </DialogDescription>
        </DialogHeader>

        {existingId ? (
          <div className="space-y-2 text-[13px]">
            <p>A provider with this email or NPI is already in this organization.</p>
            <p className="text-muted-foreground">
              The invite goes to the email on their record and replaces any earlier link. To check
              or correct their details first, open their{" "}
              <Link
                to="/providers/$id"
                params={{ id: existingId }}
                className="underline"
                onClick={onClose}
              >
                provider record
              </Link>{" "}
              instead.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="invite-first">First name</Label>
                <Input
                  id="invite-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-last">Last name</Label>
                <Input
                  id="invite-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-group">Group</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger id="invite-group">
                  <SelectValue placeholder="Choose a group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} disabled>
                    Choose a group
                  </SelectItem>
                  {(groups.data ?? [])
                    .filter((g) => g.isActive)
                    .map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <details className="text-[13px]">
              <summary className="cursor-pointer text-muted-foreground">
                + NPI and start date (optional)
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="invite-npi">NPI</Label>
                  <Input
                    id="invite-npi"
                    value={npi}
                    onChange={(e) => setNpi(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    inputMode="numeric"
                    placeholder="10 digits"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-start">Start date</Label>
                  <Input
                    id="invite-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
              </div>
            </details>
          </div>
        )}

        {error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {existingId ? (
            <Button onClick={onResend} disabled={resend.isPending}>
              {resend.isPending ? "Sending…" : "Send them an invite"}
            </Button>
          ) : (
            <Button onClick={onSend} disabled={!ready || invite.isPending}>
              {invite.isPending ? "Sending…" : "Send invite"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
