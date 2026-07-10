// Onboarding shell (E0.8): org intake form + side panel with share-link and
// begin-onboarding actions. This is an authenticated route inside AppShell.
// Does NOT use useOrgCreateForm because that hook's underlying useCreateOrganization
// navigates to /get-started on success — the onboarding page must stay in place
// and show a read-only summary after creation. Instead, the form state, validation,
// and submit are managed locally, and the mutation calls createOrganization directly
// with a custom onSuccess that loads memberships + sets active org without navigating.
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Link2, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createOrganization } from "@/services/organizations";
import { useIssueCaptureLink } from "@/hooks/useCaptureLinks";
import {
  isValidEmail,
  commonEmailDomainTypo,
  contactErrors,
  hasContactErrors,
  type ContactFieldErrors,
} from "@/lib/contactValidation";
import { EMPTY_CONTACT, DEFAULT_SALES_REP } from "@/lib/contacts";
import { renderCaptureEmail } from "@/lib/captureEmail";
import { useAuthStore } from "@/lib/auth-store";
import type { ContactInput, IssuedCaptureLink } from "@/types";

export const Route = createFileRoute("/onboarding/")({
  component: OnboardingPage,
});

// ---------- form field errors ----------

interface OrgFieldErrors {
  name?: string;
  ownerName?: string;
  ownerEmail?: string;
  form?: string;
}

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

// ---------- share-link dialog ----------

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
              {issue.isPending ? "Issuing..." : "Issue link"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- success summary ----------

interface OrgSummaryData {
  name: string;
  ownerName: string;
  ownerEmail: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
}

function SuccessSummary({ data }: { data: OrgSummaryData }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[#D1FAE5] bg-[#ECFDF5] px-4 py-3 text-[13px] text-[#065F46]">
        Organization created successfully.
      </div>
      <div className="space-y-3">
        <div>
          <div className="text-[12px] font-medium text-muted-foreground">Organization name</div>
          <div className="text-[14px] text-foreground">{data.name}</div>
        </div>
        <Separator />
        <div className="text-[13px] font-semibold text-foreground">Authorized contact</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[12px] font-medium text-muted-foreground">Name</div>
            <div className="text-[14px] text-foreground">{data.ownerName}</div>
          </div>
          <div>
            <div className="text-[12px] font-medium text-muted-foreground">Email</div>
            <div className="text-[14px] text-foreground">{data.ownerEmail}</div>
          </div>
        </div>
        <Separator />
        <div className="text-[13px] font-semibold text-foreground">Organization contact</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[12px] font-medium text-muted-foreground">Name</div>
            <div className="text-[14px] text-foreground">{data.customerName}</div>
          </div>
          <div>
            <div className="text-[12px] font-medium text-muted-foreground">Email</div>
            <div className="text-[14px] text-foreground">{data.customerEmail}</div>
          </div>
          {data.customerPhone ? (
            <div>
              <div className="text-[12px] font-medium text-muted-foreground">Phone</div>
              <div className="text-[14px] text-foreground">{data.customerPhone}</div>
            </div>
          ) : null}
        </div>
        <Separator />
        <div className="text-[13px] font-semibold text-foreground">Organization address</div>
        <div>
          <div className="text-[12px] font-medium text-muted-foreground">Street</div>
          <div className="text-[14px] text-foreground">
            {data.addressLine1}
            {data.addressLine2 ? `, ${data.addressLine2}` : ""}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-2">
            <div className="text-[12px] font-medium text-muted-foreground">City</div>
            <div className="text-[14px] text-foreground">{data.city}</div>
          </div>
          <div>
            <div className="text-[12px] font-medium text-muted-foreground">State</div>
            <div className="text-[14px] text-foreground">{data.state}</div>
          </div>
          <div>
            <div className="text-[12px] font-medium text-muted-foreground">Postal code</div>
            <div className="text-[14px] text-foreground">{data.postalCode}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- onboarding form ----------

function OnboardingForm({ onCreated }: { onCreated: (data: OrgSummaryData) => void }) {
  const loadMemberships = useAuthStore((s) => s.loadMemberships);
  const setActiveOrg = useAuthStore((s) => s.setActiveOrg);

  // Form state (mirrors useOrgCreateForm but without its auto-navigation)
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [customer, setCustomer] = useState<ContactInput>(EMPTY_CONTACT);
  const [errors, setErrors] = useState<OrgFieldErrors>({});
  const [custErrors, setCustErrors] = useState<ContactFieldErrors>({});

  const emailWarning = ownerEmail.trim() ? commonEmailDomainTypo(ownerEmail) : null;

  const patchCustomer = (p: Partial<ContactInput>) => setCustomer((c) => ({ ...c, ...p }));

  const createOrg = useMutation({
    mutationFn: () =>
      createOrganization({
        name,
        ownerName,
        ownerEmail,
        customer,
        salesRep: DEFAULT_SALES_REP,
      }),
    onSuccess: async (orgId) => {
      await loadMemberships();
      setActiveOrg(orgId);
      toast.success("Organization created");
      onCreated({
        name: name.trim(),
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim(),
        customerName: customer.name.trim(),
        customerEmail: customer.email.trim(),
        customerPhone: customer.phoneOffice.trim(),
        addressLine1: customer.addressLine1.trim(),
        addressLine2: (customer.addressLine2 ?? "").trim(),
        city: customer.city.trim(),
        state: customer.state.trim(),
        postalCode: customer.postalCode.trim(),
      });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Couldn't create organization";
      setErrors((prev) => ({ ...prev, form: msg }));
      toast.error(msg);
    },
  });

  function validate(): boolean {
    const next: OrgFieldErrors = {};
    if (!name.trim()) next.name = "Organization name is required";
    if (!ownerName.trim()) next.ownerName = "Owner name is required";
    if (!ownerEmail.trim()) next.ownerEmail = "Owner email is required";
    else if (!isValidEmail(ownerEmail)) next.ownerEmail = "Enter a valid email address";
    const cErr = contactErrors(customer);
    setErrors(next);
    setCustErrors(cErr);
    return !next.name && !next.ownerName && !next.ownerEmail && !hasContactErrors(cErr);
  }

  function handleSubmit() {
    if (!validate()) return;
    createOrg.mutate();
  }

  return (
    <div className="space-y-4">
      {/* Organization name */}
      <div>
        <Label className="text-[12px]" htmlFor="onb-org-name">
          Organization name
        </Label>
        <Input
          id="onb-org-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          className="mt-1 h-9"
        />
        {errors.name ? <div className="mt-1 text-[12px] text-[#B91C1C]">{errors.name}</div> : null}
      </div>

      <Separator />

      {/* Authorized contact (owner) */}
      <div className="space-y-3">
        <div className="text-[13px] font-semibold text-foreground">Authorized contact</div>
        <div>
          <Label className="text-[12px]" htmlFor="onb-owner-name">
            Name
          </Label>
          <Input
            id="onb-owner-name"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            aria-invalid={errors.ownerName ? true : undefined}
            className="mt-1 h-9"
          />
          {errors.ownerName ? (
            <div className="mt-1 text-[12px] text-[#B91C1C]">{errors.ownerName}</div>
          ) : null}
        </div>
        <div>
          <Label className="text-[12px]" htmlFor="onb-owner-email">
            Email
          </Label>
          <Input
            id="onb-owner-email"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            aria-invalid={errors.ownerEmail ? true : undefined}
            className="mt-1 h-9"
          />
          {errors.ownerEmail ? (
            <div className="mt-1 text-[12px] text-[#B91C1C]">{errors.ownerEmail}</div>
          ) : null}
          {emailWarning ? (
            <button
              type="button"
              className="mt-1 text-[12px] text-[#92400E] underline"
              onClick={() => setOwnerEmail(emailWarning)}
            >
              Did you mean {emailWarning}?
            </button>
          ) : null}
        </div>
      </div>

      <Separator />

      {/* Organization contact (customer) — name, email, phone */}
      <div className="space-y-3">
        <div className="text-[13px] font-semibold text-foreground">Organization contact</div>
        <div>
          <Label className="text-[12px]" htmlFor="onb-cust-name">
            Name
          </Label>
          <Input
            id="onb-cust-name"
            value={customer.name}
            onChange={(e) => patchCustomer({ name: e.target.value })}
            aria-invalid={custErrors.name ? true : undefined}
            className="mt-1 h-9"
          />
          {custErrors.name ? (
            <div className="mt-1 text-[12px] text-[#B91C1C]">{custErrors.name}</div>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-[12px]" htmlFor="onb-cust-email">
              Email
            </Label>
            <Input
              id="onb-cust-email"
              type="email"
              value={customer.email}
              onChange={(e) => patchCustomer({ email: e.target.value })}
              aria-invalid={custErrors.email ? true : undefined}
              className="mt-1 h-9"
            />
            {custErrors.email ? (
              <div className="mt-1 text-[12px] text-[#B91C1C]">{custErrors.email}</div>
            ) : null}
          </div>
          <div>
            <Label className="text-[12px]" htmlFor="onb-cust-phone">
              Phone
            </Label>
            <Input
              id="onb-cust-phone"
              value={customer.phoneOffice}
              onChange={(e) => patchCustomer({ phoneOffice: e.target.value })}
              aria-invalid={custErrors.phoneOffice ? true : undefined}
              className="mt-1 h-9"
            />
            {custErrors.phoneOffice ? (
              <div className="mt-1 text-[12px] text-[#B91C1C]">{custErrors.phoneOffice}</div>
            ) : null}
          </div>
        </div>
      </div>

      <Separator />

      {/* Organization address — stored on the customer party's address fields */}
      <div className="space-y-3">
        <div className="text-[13px] font-semibold text-foreground">Organization address</div>
        <div>
          <Label className="text-[12px]" htmlFor="onb-addr-line1">
            Street address
          </Label>
          <Input
            id="onb-addr-line1"
            value={customer.addressLine1}
            onChange={(e) => patchCustomer({ addressLine1: e.target.value })}
            aria-invalid={custErrors.addressLine1 ? true : undefined}
            className="mt-1 h-9"
          />
          {custErrors.addressLine1 ? (
            <div className="mt-1 text-[12px] text-[#B91C1C]">{custErrors.addressLine1}</div>
          ) : null}
        </div>
        <div>
          <Label className="text-[12px]" htmlFor="onb-addr-line2">
            Suite / unit <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="onb-addr-line2"
            value={customer.addressLine2 ?? ""}
            onChange={(e) => patchCustomer({ addressLine2: e.target.value })}
            className="mt-1 h-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-2">
            <Label className="text-[12px]" htmlFor="onb-addr-city">
              City
            </Label>
            <Input
              id="onb-addr-city"
              value={customer.city}
              onChange={(e) => patchCustomer({ city: e.target.value })}
              aria-invalid={custErrors.city ? true : undefined}
              className="mt-1 h-9"
            />
            {custErrors.city ? (
              <div className="mt-1 text-[12px] text-[#B91C1C]">{custErrors.city}</div>
            ) : null}
          </div>
          <div>
            <Label className="text-[12px]" htmlFor="onb-addr-state">
              State
            </Label>
            <Input
              id="onb-addr-state"
              value={customer.state}
              onChange={(e) => patchCustomer({ state: e.target.value })}
              aria-invalid={custErrors.state ? true : undefined}
              className="mt-1 h-9"
            />
            {custErrors.state ? (
              <div className="mt-1 text-[12px] text-[#B91C1C]">{custErrors.state}</div>
            ) : null}
          </div>
          <div>
            <Label className="text-[12px]" htmlFor="onb-addr-zip">
              Postal code
            </Label>
            <Input
              id="onb-addr-zip"
              value={customer.postalCode}
              onChange={(e) => patchCustomer({ postalCode: e.target.value })}
              aria-invalid={custErrors.postalCode ? true : undefined}
              className="mt-1 h-9"
            />
            {custErrors.postalCode ? (
              <div className="mt-1 text-[12px] text-[#B91C1C]">{custErrors.postalCode}</div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Form-level error */}
      {errors.form ? (
        <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
          {errors.form}
        </div>
      ) : null}

      <Button
        type="button"
        onClick={handleSubmit}
        disabled={createOrg.isPending}
        className="w-full bg-[#1B4D3E] text-white hover:bg-[#163E32]"
      >
        {createOrg.isPending ? "Creating..." : "Create organization"}
      </Button>
    </div>
  );
}

// ---------- main page ----------

function OnboardingPage() {
  const navigate = useNavigate();
  const [summaryData, setSummaryData] = useState<OrgSummaryData | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const created = summaryData !== null;

  return (
    <div className="space-y-6">
      <PageHeader title="New organization" />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* Left side: org intake form or success summary */}
        <Card>
          <CardContent className="p-4">
            {created ? (
              <SuccessSummary data={summaryData} />
            ) : (
              <OnboardingForm onCreated={setSummaryData} />
            )}
          </CardContent>
        </Card>

        {/* Right side: persistent side panel */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <h3 className="text-[14px] font-semibold text-foreground">Actions</h3>
              <Button
                type="button"
                onClick={() => setShareOpen(true)}
                disabled={!created}
                className="w-full bg-[#1B4D3E] text-white hover:bg-[#163E32]"
              >
                <Link2 className="h-4 w-4" />
                Share onboarding link
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: "/onboarding/wizard" })}
                disabled={!created}
                className="w-full"
              >
                <ArrowRight className="h-4 w-4" />
                Begin onboarding
              </Button>
              {!created ? (
                <p className="text-[11px] text-muted-foreground">
                  Create the organization first to unlock these actions.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {shareOpen ? <ShareLinkDialog onClose={() => setShareOpen(false)} /> : null}
    </div>
  );
}
