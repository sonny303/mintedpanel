// Onboarding-wizard composition hook (E1.0 TE-2/TE-5). Supplies the wizard
// route with the active org's contacts, provider groups, facilities, and
// providers through the EXISTING domain hooks (org-scoped queryKeys, so every
// group/facility/provider/party mutation invalidates the same caches — no
// separately cached progress summary), and derives per-section status with the
// pure src/lib/onboardingProgress resolvers. A failed read is surfaced as an
// inline retriable error state and is NEVER interpreted as not_started; the
// next action is computed only once all four reads have resolved (TE-4).
import { useOrgContacts } from "@/hooks/useParties";
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import { useProviders } from "@/hooks/useProviders";
import { useActiveMembership } from "@/lib/auth-store";
import {
  getNextIncompleteSection,
  resolveOrgDetailsStatus,
  resolveRowCountStatus,
  type ActiveSectionKey,
  type OnboardingSectionDef,
  type OnboardingSectionStatus,
} from "@/lib/onboardingProgress";
import type { OrgContact } from "@/types";

export interface OnboardingSectionState {
  /** Resolved status; undefined while the backing read is loading or failed. */
  status: OnboardingSectionStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export interface OnboardingWizardData {
  sections: Record<ActiveSectionKey, OnboardingSectionState>;
  /**
   * First incomplete active section. `undefined` while any required read is
   * unresolved (loading or error — no next action is computed then, TE-4);
   * `null` when all four R1 sections are complete (show the R3 preview).
   */
  nextSection: OnboardingSectionDef | null | undefined;
  /** Live org-details display data for the Org details section body. */
  orgName: string | null;
  contacts: OrgContact[];
  /** Row counts for the presence-based section bodies. */
  providerGroupCount: number;
  facilityCount: number;
  providerCount: number;
}

export function useOnboardingWizard(): OnboardingWizardData {
  const active = useActiveMembership();
  const contactsQ = useOrgContacts();
  const groupsQ = useProviderGroups();
  const facilitiesQ = useFacilities();
  // List projection only (TE-6): src/services/providers.ts omits ssn_last4,
  // date of birth, and home-address columns; progress uses the row count.
  const providersQ = useProviders();

  const contacts = contactsQ.data ?? [];
  const orgName = active?.orgName ?? null;

  const orgDetails: OnboardingSectionState = {
    status: contactsQ.data
      ? resolveOrgDetailsStatus({
          orgName,
          owner: contacts.find((c) => c.roleKey === "owner")?.party ?? null,
          customer:
            contacts.find((c) => c.roleKey === "customer_escalation_contact")?.party ?? null,
        })
      : undefined,
    isLoading: contactsQ.isLoading,
    isError: contactsQ.isError,
    refetch: contactsQ.refetch,
  };

  const countSection = (q: {
    data: unknown[] | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
  }): OnboardingSectionState => ({
    status: q.data ? resolveRowCountStatus(q.data.length) : undefined,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  });

  const sections: Record<ActiveSectionKey, OnboardingSectionState> = {
    org_details: orgDetails,
    provider_group: countSection(groupsQ),
    facilities: countSection(facilitiesQ),
    providers: countSection(providersQ),
  };

  const orgDetailsStatus = sections.org_details.status;
  const groupStatus = sections.provider_group.status;
  const facilitiesStatus = sections.facilities.status;
  const providersStatus = sections.providers.status;
  const nextSection =
    orgDetailsStatus && groupStatus && facilitiesStatus && providersStatus
      ? getNextIncompleteSection({
          org_details: orgDetailsStatus,
          provider_group: groupStatus,
          facilities: facilitiesStatus,
          providers: providersStatus,
        })
      : undefined;

  return {
    sections,
    nextSection,
    orgName,
    contacts,
    providerGroupCount: groupsQ.data?.length ?? 0,
    facilityCount: facilitiesQ.data?.length ?? 0,
    providerCount: providersQ.data?.length ?? 0,
  };
}
