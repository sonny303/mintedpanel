// Onboarding shell (E0.8 F0.8.1/F0.8.3, TE-1/TE-3/TE-4): standalone authenticated
// page reached from the org switcher's Add organization item. Split layout — the
// left side is the org intake form driven by the SHARED useOrgCreateForm +
// OrgCreateFields (TE-3: same labels/validation/RPC-error surfacing as every
// other intake surface; post-create the hook navigates to the new org's
// /get-started, the Account Detail page). The right side is a persistent panel
// with the two onboarding journeys for the ACTIVE org: Share onboarding link
// (the relocated capture-link flow — a popup with exactly one typed-in
// recipient, no party dropdown, F0.8.3) and Begin onboarding (→
// /onboarding/wizard, F0.8.4).
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Copy, Link2, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OrgCreateFields } from "@/components/org/OrgCreateFields";
import { useOrgCreateForm } from "@/hooks/useOrgCreateForm";
import { useIssueCaptureLink } from "@/hooks/useCaptureLinks";
import { isValidEmail, commonEmailDomainTypo } from "@/lib/contactValidation";
import { renderCaptureEmail } from "@/lib/captureEmail";
import { useAuthStore, useActiveMembership } from "@/lib/auth-store";
import type { IssuedCaptureLink } from "@/types";

export const Route = createFileRoute("/onboarding/")({
  component: OnboardingPage,
});

// ---------- helpers ----------

function captureUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/capture/${token}`;
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy — select and copy manually");
  }
}

// ---------- share-link dialog (F0.8.3) ----------
// Always targets exactly one typed-in recipient: name (required) + email
// (required). The E0.5 party-picker dropdown is deliberately gone. Issue goes
// through the same create_capture_link re-issue semantics (TE-4).

function ShareLinkDialog({ onClose }: { onClose: () => void }) {
  const issue = useIssueCaptureLink();
  const operatorEmail = useAuthStore((s) => s.user?.email ?? "your Minted Panel contact");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [issued, setIssued] = useState<IssuedCaptureLink | null>(null);

  const emailTrimmed = recipientEmail.trim();
  const canIssue =
    recipientName.trim().length > 0 && isValidEmail(emailTrimmed) && !issue.isPending;

  const emailWarning = emailTrimmed ? commonEmailDomainTypo(emailTrimmed) : null;

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

  function onIssue() {
    issue.mutate(
      {
        recipientEmail: emailTrimmed,
        recipientName: recipientName.trim(),
      },
      {
        onSuccess: (result) => {
          setIssued(result);
          toast.success("Onboarding link ready to send");
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't issue link"),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share onboarding link</DialogTitle>
        </DialogHeader>
        {issued && emailPreview ? (
          <div className="space-y-3">
            <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[12px] font-medium text-[#92400E]">
              Copy the link and the email text, then send it to {issued.recipientEmail}. The link
              won't be shown again.
            </div>
            <div>
              <Label className="text-[12px]">Secure link</Label>
              <div className="mt-1 flex gap-2">
                <Input readOnly value={captureUrl(issued.token)} className="h-9 bg-white" />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 shrink-0"
                  onClick={() => copyText(captureUrl(issued.token), "Link")}
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
                onClick={() => copyText(`${emailPreview.subject}\n\n${emailPreview.body}`, "Email")}
              >
                <Copy className="h-4 w-4" />
                Copy email
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-muted-foreground">
              Generate a secure, single-use link so someone outside your team can confirm this
              organization's details.
            </p>
            <div>
              <Label className="text-[12px]" htmlFor="share-name">
                Recipient name
              </Label>
              <Input
                id="share-name"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label className="text-[12px]" htmlFor="share-email">
                Recipient email
              </Label>
              <Input
                id="share-email"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="mt-1 h-9"
              />
              {emailWarning ? (
                <button
                  type="button"
                  className="mt-1 text-[12px] text-[#92400E] underline"
                  onClick={() => setRecipientEmail(emailWarning)}
                >
                  Did you mean {emailWarning}?
                </button>
              ) : null}
            </div>
            <Button
              type="button"
              onClick={onIssue}
              disabled={!canIssue}
              className="w-full bg-[#1B4D3E] text-white hover:bg-[#163E32]"
            >
              <Link2 className="h-4 w-4" />
              {issue.isPending ? "Sharing…" : "Share onboarding link"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- main page ----------

function OnboardingPage() {
  const navigate = useNavigate();
  const active = useActiveMembership();
  const form = useOrgCreateForm();
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader title="New organization" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left: the shared org intake form. Post-create the hook navigates to
            the new org's /get-started (Account Detail) — F0.8.1 AC / TE-3. */}
        <Card>
          <CardContent className="p-4">
            <form
              noValidate
              aria-label="Organization intake"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                form.submit();
              }}
            >
              <OrgCreateFields form={form} />
              <Button
                type="submit"
                disabled={form.isPending}
                className="w-full bg-[#1B4D3E] text-white hover:bg-[#163E32]"
              >
                {form.isPending ? "Creating…" : "Create organization"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Right: persistent side panel — the two onboarding journeys for the
            ACTIVE org (F0.8.3). These act on the currently-selected org, NOT
            the new org being created on the left, so the scope is spelled out
            explicitly here to avoid the "wrong org" footgun. */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <h3 className="text-[14px] font-semibold text-foreground">Onboarding actions</h3>
              {active ? (
                <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#92400E]">
                  These actions apply to your current organization,{" "}
                  <span className="font-semibold">{active.orgName}</span> — not the new organization
                  you're creating on the left.
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  Select or create an organization to use these actions.
                </p>
              )}
              <Button
                type="button"
                onClick={() => setShareOpen(true)}
                disabled={!active}
                className="w-full bg-[#1B4D3E] text-white hover:bg-[#163E32]"
              >
                <Link2 className="h-4 w-4" />
                Share onboarding link
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: "/onboarding/wizard" })}
                disabled={!active}
                className="w-full"
              >
                <ArrowRight className="h-4 w-4" />
                Begin onboarding
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {shareOpen ? <ShareLinkDialog onClose={() => setShareOpen(false)} /> : null}
    </div>
  );
}
