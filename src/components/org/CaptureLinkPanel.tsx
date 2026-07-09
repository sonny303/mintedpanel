// Operator surface for the secure data capture link (redesign E0.5, TE-2/TE-4/
// TE-5). Composed only from existing primitives. Shows the org's current link
// state, lets P1 issue/re-issue a link to an existing party (owner/customer/…) or
// a new email, and — since Stage 0 has NO email send infra (BD-2) — renders the
// copy-able link URL + email text for P1 to send manually.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCaptureLink, useIssueCaptureLink } from "@/hooks/useCaptureLinks";
import { useOrgParties } from "@/hooks/useParties";
import { isValidEmail } from "@/lib/contactValidation";
import { PARTY_ROLE_LABELS } from "@/lib/contacts";
import { renderCaptureEmail } from "@/lib/captureEmail";
import { fmtDateTime } from "@/lib/format";
import { useAuthStore } from "@/lib/auth-store";
import type { CaptureLinkState, IssuedCaptureLink } from "@/types";

const OTHER = "__other__";

const STATE_LABEL: Record<CaptureLinkState, string> = {
  active: "Active",
  used: "Completed",
  expired: "Expired",
  revoked: "Replaced",
};

function captureUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/capture/${token}`;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy — select and copy manually");
  }
}

export function CaptureLinkPanel() {
  const { data: link } = useCaptureLink();
  const { data: parties } = useOrgParties();
  const issue = useIssueCaptureLink();
  const operatorEmail = useAuthStore((s) => s.user?.email ?? "your Minted Panel contact");

  const [target, setTarget] = useState<string>(OTHER);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<IssuedCaptureLink | null>(null);

  const email_ = email.trim();
  const canIssue = isValidEmail(email_) && !issue.isPending;

  const emailPreview = useMemo(() => {
    if (!issued) return null;
    return renderCaptureEmail({
      orgName: issued.orgName,
      recipientName: issued.recipientName,
      captureUrl: captureUrl(issued.token),
      expiresAt: issued.expiresAt,
      operatorContact: operatorEmail,
    });
  }, [issued, operatorEmail]);

  function onSelectTarget(value: string) {
    setTarget(value);
    if (value === OTHER) {
      setEmail("");
      setName("");
      return;
    }
    const p = parties?.find((op) => op.party.id === value)?.party;
    setEmail(p?.email ?? "");
    setName(p?.name ?? "");
  }

  function onIssue() {
    issue.mutate(
      {
        recipientEmail: email_,
        partyId: target === OTHER ? null : target,
        recipientName: name.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          setIssued(result);
          toast.success("Capture link ready to send");
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't issue link"),
      },
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold text-foreground">Data capture link</h2>
          {link ? (
            <Badge variant="secondary" className="ml-auto">
              {STATE_LABEL[link.state]}
            </Badge>
          ) : null}
        </div>
        <p className="text-[13px] text-muted-foreground">
          Send a secure, single-use link so someone outside your team can confirm this
          organization's details. The link expires after 72 hours or on first use — no login is
          created.
        </p>

        {link ? (
          <div className="rounded-md border border-[#E8E5E0] bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
            {link.state === "active"
              ? `A link to ${link.recipientEmail} is active until ${fmtDateTime(link.expiresAt)}.`
              : link.state === "used"
                ? `The link to ${link.recipientEmail} was completed on ${fmtDateTime(link.usedAt)}.`
                : `The last link to ${link.recipientEmail} is ${STATE_LABEL[link.state].toLowerCase()}. Issue a new one below.`}
          </div>
        ) : null}

        {issued && emailPreview ? (
          <div className="space-y-3 rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3">
            <div className="text-[12px] font-medium text-[#92400E]">
              Copy the link (and the email text) and send it to {issued.recipientEmail}. It won't be
              shown again.
            </div>
            <div>
              <Label className="text-[12px]">Secure link</Label>
              <div className="mt-1 flex gap-2">
                <Input readOnly value={captureUrl(issued.token)} className="h-9 bg-white" />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 shrink-0"
                  onClick={() => copy(captureUrl(issued.token), "Link")}
                >
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-[12px]">Email to send</Label>
              <Input readOnly value={emailPreview.subject} className="mt-1 h-9 bg-white" />
              <Textarea
                readOnly
                value={emailPreview.body}
                rows={8}
                className="mt-2 bg-white text-[12px]"
              />
              <Button
                type="button"
                variant="outline"
                className="mt-2 h-9"
                onClick={() => copy(`${emailPreview.subject}\n\n${emailPreview.body}`, "Email")}
              >
                <Copy className="h-4 w-4" />
                Copy email
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="h-8 text-[12px]"
              onClick={() => setIssued(null)}
            >
              Issue another link
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-[12px]" htmlFor="capture-target">
                Send to
              </Label>
              <Select value={target} onValueChange={onSelectTarget}>
                <SelectTrigger id="capture-target" className="mt-1 h-9">
                  <SelectValue placeholder="Choose a recipient" />
                </SelectTrigger>
                <SelectContent>
                  {(parties ?? []).map((op) => (
                    <SelectItem key={op.party.id} value={op.party.id}>
                      {op.party.name}
                      {op.roleKeys.length > 0
                        ? ` · ${op.roleKeys.map((r) => PARTY_ROLE_LABELS[r]).join(", ")}`
                        : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER}>Someone else…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-[12px]" htmlFor="capture-email">
                  Recipient email
                </Label>
                <Input
                  id="capture-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 h-9"
                />
              </div>
              {target === OTHER ? (
                <div>
                  <Label className="text-[12px]" htmlFor="capture-name">
                    Recipient name <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="capture-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 h-9"
                  />
                </div>
              ) : null}
            </div>
            <Button
              type="button"
              onClick={onIssue}
              disabled={!canIssue}
              className="bg-[#1B4D3E] text-white hover:bg-[#163E32]"
            >
              {link?.state === "active" ? (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Re-issue link
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4" />
                  Generate link
                </>
              )}
            </Button>
            {link?.state === "active" ? (
              <p className="text-[11px] text-muted-foreground">
                Re-issuing revokes the current link and creates a fresh one.
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
