// Shared create-org form state + client-side validation for E0.1 + E0.2. Both
// intake surfaces (first-run NoOrgScreen and CreateOrganizationModal) drive off
// this so the required-owner rules (E0.1), the required customer + sales-rep
// contacts (E0.2 FR-2, sales rep pre-filled with Zeb), the email-typo nudge, and
// the RPC-error surfacing stay identical. The server (create_organization RPC)
// remains the enforcement authority; this is the pre-submit gate.
import { useState } from "react";
import { toast } from "sonner";
import { useCreateOrganization } from "@/hooks/useOrganizations";
import {
  isValidEmail,
  commonEmailDomainTypo,
  contactErrors,
  hasContactErrors,
  type ContactFieldErrors,
} from "@/lib/contactValidation";
import { EMPTY_CONTACT, DEFAULT_SALES_REP } from "@/lib/contacts";
import type { ContactInput } from "@/types";

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
  const [customer, setCustomer] = useState<ContactInput>(EMPTY_CONTACT);
  const [salesRep, setSalesRep] = useState<ContactInput>(DEFAULT_SALES_REP);
  const [errors, setErrors] = useState<OrgCreateFieldErrors>({});
  const [customerErrors, setCustomerErrors] = useState<ContactFieldErrors>({});
  const [salesErrors, setSalesErrors] = useState<ContactFieldErrors>({});

  const emailWarning = ownerEmail.trim() ? commonEmailDomainTypo(ownerEmail) : null;

  function validate(): boolean {
    const next: OrgCreateFieldErrors = {};
    if (!name.trim()) next.name = "Organization name is required";
    if (!ownerName.trim()) next.ownerName = "Owner name is required";
    if (!ownerEmail.trim()) next.ownerEmail = "Owner email is required";
    else if (!isValidEmail(ownerEmail)) next.ownerEmail = "Enter a valid email address";
    const cErr = contactErrors(customer);
    const sErr = contactErrors(salesRep);
    setErrors(next);
    setCustomerErrors(cErr);
    setSalesErrors(sErr);
    return (
      !next.name &&
      !next.ownerName &&
      !next.ownerEmail &&
      !hasContactErrors(cErr) &&
      !hasContactErrors(sErr)
    );
  }

  function submit() {
    if (!validate()) return;
    createOrg.mutate(
      { name, ownerName, ownerEmail, customer, salesRep },
      {
        onSuccess: () => {
          toast.success("Organization created");
          opts?.onCreated?.();
        },
        onError: (e) => {
          const msg = e instanceof Error ? e.message : "Couldn't create organization";
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
    customer,
    patchCustomer: (p: Partial<ContactInput>) => setCustomer((c) => ({ ...c, ...p })),
    salesRep,
    patchSalesRep: (p: Partial<ContactInput>) => setSalesRep((c) => ({ ...c, ...p })),
    errors,
    customerErrors,
    salesErrors,
    emailWarning,
    applyEmailSuggestion: () => {
      if (emailWarning) setOwnerEmail(emailWarning);
    },
    submit,
    isPending: createOrg.isPending,
  };
}

export type OrgCreateForm = ReturnType<typeof useOrgCreateForm>;
