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
  resolveActiveRowsStatus,
  resolveOrgDetailsStatus,
  resolveProviderGroupStatus,
  resolveRowCountStatus,
  type ActiveSectionKey,
  type OnboardingSectionDef,
  type OnboardingSectionStatus,
} from "@/lib/onboardingProgress";
import type { Facility, OrgContact, Provider, ProviderGroup } from "@/types";

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
  /** The org's provider groups (E1.1 section list; active rows complete it). */
  providerGroups: ProviderGroup[];
  /** The org's facilities (E1.2 section list; active rows complete it). */
  facilities: Facility[];
  /** The org's roster rows — the PHI-narrowed list projection (E1.3). */
  providers: Provider[];
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
    // E1.1: complete on ≥1 ACTIVE group (soft-deleted groups don't count).
    provider_group: {
      status: groupsQ.data ? resolveProviderGroupStatus(groupsQ.data) : undefined,
      isLoading: groupsQ.isLoading,
      isError: groupsQ.isError,
      refetch: groupsQ.refetch,
    },
    // E1.2: complete on ≥1 ACTIVE facility (same active-rows rule).
    facilities: {
      status: facilitiesQ.data ? resolveActiveRowsStatus(facilitiesQ.data) : undefined,
      isLoading: facilitiesQ.isLoading,
      isError: facilitiesQ.isError,
      refetch: facilitiesQ.refetch,
    },
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
    providerGroups: groupsQ.data ?? [],
    facilities: facilitiesQ.data ?? [],
    providers: providersQ.data ?? [],
  };
}
