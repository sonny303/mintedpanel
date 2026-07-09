// Shared create-org form state + client-side validation for E0.1. Both intake
// surfaces (the first-run NoOrgScreen and the CreateOrganizationModal) drive off
// this so the required-owner rules, the email-typo nudge, and the RPC-error
// surfacing stay identical. The server (create_organization RPC v2) remains the
// enforcement authority; this is the pre-submit gate + friendly feedback.
import { useState } from "react";
import { toast } from "sonner";
import { useCreateOrganization } from "@/hooks/useOrganizations";
import { isValidEmail, commonEmailDomainTypo } from "@/lib/contactValidation";

export interface OrgCreateFieldErrors {
  name?: string;
  ownerName?: string;
  ownerEmail?: string;
  /** RPC / submit-level error (e.g. the duplicate-org message, shown verbatim). */
  form?: string;
}

export function useOrgCreateForm(opts?: { onCreated?: () => void }) {
  const createOrg = useCreateOrganization();
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [errors, setErrors] = useState<OrgCreateFieldErrors>({});

  const emailWarning = ownerEmail.trim() ? commonEmailDomainTypo(ownerEmail) : null;

  function validate(): boolean {
    const next: OrgCreateFieldErrors = {};
    if (!name.trim()) next.name = "Organization name is required";
    if (!ownerName.trim()) next.ownerName = "Owner name is required";
    if (!ownerEmail.trim()) next.ownerEmail = "Owner email is required";
    else if (!isValidEmail(ownerEmail)) next.ownerEmail = "Enter a valid email address";
    setErrors(next);
    return !next.name && !next.ownerName && !next.ownerEmail;
  }

  function submit() {
    if (!validate()) return;
    createOrg.mutate(
      { name, ownerName, ownerEmail },
      {
        onSuccess: () => {
          toast.success("Organization created");
          opts?.onCreated?.();
        },
        onError: (e) => {
          const msg = e instanceof Error ? e.message : "Couldn't create organization";
          // The RPC's duplicate/owner messages are user-facing and descriptive
          // (F0.1.4) — surface them verbatim.
          setErrors((prev) => ({ ...prev, form: msg }));
          toast.error(msg);
        },
      },
    );
  }

  return {
    name,
    setName: (v: string) => setName(v),
    ownerName,
    setOwnerName: (v: string) => setOwnerName(v),
    ownerEmail,
    setOwnerEmail: (v: string) => setOwnerEmail(v),
    errors,
    emailWarning,
    applyEmailSuggestion: () => {
      if (emailWarning) setOwnerEmail(emailWarning);
    },
    submit,
    isPending: createOrg.isPending,
    canSubmit: Boolean(name.trim() && ownerName.trim() && ownerEmail.trim()),
  };
}

export type OrgCreateForm = ReturnType<typeof useOrgCreateForm>;
