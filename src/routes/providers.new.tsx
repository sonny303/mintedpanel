// Add Provider entry point. The 5-step form lives in ProviderForm; this
// route wires it to createProviderWithDetails so licenses and facility
// assignments captured in steps 3 and 4 are persisted alongside the provider.
// A ?locationId search param (legacy launch links) still pre-selects that
// location's group and facility.
//
// E6.3 F6.3.5 — onboarding a provider creates ZERO cases: the starter-case
// auto-attach is RETIRED outright (generation is the one door; candidates
// surface in the group board's buffer instead). The org_payer_assignments
// `starter` column stays dormant per the additive rule.
import { useEffect, useMemo } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { useActiveOrgId, useAuthStore, useRole } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import { useLaunchLocation } from "@/hooks/useLaunches";
import {
  ProviderForm,
  emptyProviderFormState,
  type ProviderFormState,
} from "@/components/providers/ProviderForm";
import {
  createProviderWithDetails,
  type CreateProviderWithDetailsInput,
  type CreateProviderWithDetailsResult,
  type LicenseInput,
  type ProviderInput,
} from "@/services/providers";

export const Route = createFileRoute("/providers/new")({
  validateSearch: (search: Record<string, unknown>): { locationId?: string } => ({
    locationId: typeof search.locationId === "string" ? search.locationId : undefined,
  }),
  beforeLoad: () => {
    const { memberships, activeOrgId } = useAuthStore.getState();
    const role = memberships.find((m) => m.orgId === activeOrgId)?.role ?? null;
    if (role === "billing") {
      throw redirect({ to: "/providers", replace: true });
    }
  },
  component: Page,
});

function toProviderInput(form: ProviderFormState): ProviderInput {
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    credentials: form.credentials.trim() || null,
    dateOfBirth: form.dateOfBirth || null,
    ssnLast4: form.ssnLast4 || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    npi: form.npi || null,
    caqhId: form.isNewGrad ? null : form.caqhId || null,
    caqhLastAttestedDate: form.isNewGrad ? null : form.caqhLastAttestedDate || null,
    taxonomyCode: form.taxonomyCode.trim() || null,
    isNewGrad: form.isNewGrad,
    // Mirror only when no groupAssignments plan — createProviderWithDetails
    // overwrites group_id from the primary assignment when one is passed.
    groupId: form.groupId || null,
    specialty: form.specialty.trim() || null,
    startDate: form.startDate || null,
    degree: form.degree.trim() || null,
    schoolName: form.schoolName.trim() || null,
    graduationDate: form.graduationDate || null,
    // Align with roster create + DB default. "Not ready / missing data" for
    // reporting is this lifecycle value + derived readiness gaps + is_new_grad
    // — not a fourth status enum value.
    status: "onboarding",
  };
}

function toLicenseInputs(form: ProviderFormState): LicenseInput[] {
  return form.licenses
    .filter((l) => l.state || l.number || l.type || l.issueDate || l.expirationDate)
    .map((l) => ({
      state: l.state,
      licenseNumber: l.number.trim() || null,
      licenseType: l.type || null,
      issueDate: l.issueDate || null,
      expirationDate: l.expirationDate || null,
    }));
}

function Page() {
  const navigate = useNavigate();
  // Render-time backstop for the beforeLoad guard: on a hard load the store
  // has no memberships yet when beforeLoad runs, so billing must also be
  // turned away here (writes are still RLS-blocked either way).
  const role = useRole();
  useEffect(() => {
    if (role === "billing") navigate({ to: "/providers", replace: true });
  }, [role, navigate]);
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  const { locationId } = Route.useSearch();
  const locationQ = useLaunchLocation(locationId);
  const launchLocation = locationId ? (locationQ.data ?? null) : null;

  const create = useMutation({
    mutationFn: (input: CreateProviderWithDetailsInput) => createProviderWithDetails(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers", orgId] });
      qc.invalidateQueries({ queryKey: ["facility-assignments", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.providerGroupAssignments(orgId) });
    },
  });

  const initial = useMemo(
    () =>
      launchLocation
        ? {
            ...emptyProviderFormState,
            groupId: launchLocation.groupId ?? "",
            facilityIds: [launchLocation.id],
          }
        : emptyProviderFormState,
    [launchLocation],
  );

  const onSubmit = async (form: ProviderFormState) => {
    try {
      const groupAssignments = form.groupId
        ? [{ groupId: form.groupId, isPrimary: true as const }]
        : undefined;
      const result: CreateProviderWithDetailsResult = await create.mutateAsync({
        provider: toProviderInput(form),
        licenses: toLicenseInputs(form),
        facilityIds: form.facilityIds,
        groupAssignments,
      });
      if (result.warnings.length > 0) {
        for (const w of result.warnings) toast.error(w);
        toast.warning("Provider created, but some details did not save. Fix them on the record.");
        navigate({ to: "/providers/$id", params: { id: result.provider.id } });
        return;
      }
      // ZERO cases created here (F6.3.5). New candidates surface in the group
      // board's awaiting-generation buffer.
      toast.success("Provider created — new payer candidates appear on the group's board.");
      navigate({ to: "/providers/$id", params: { id: result.provider.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create provider");
    }
  };

  if (role === "billing") {
    return null;
  }

  if (locationId && locationQ.isLoading) {
    return <div className="h-32 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />;
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Add provider"
        description={
          launchLocation
            ? `Pre-assigned to ${launchLocation.name}. First and last name are required; everything else can be incomplete. New providers start as Onboarding.`
            : "First and last name are required. Save with as little or as much as you have — new providers start as Onboarding until ready."
        }
      />
      <ProviderForm
        initial={initial}
        submitLabel="Create provider"
        pendingLabel="Creating…"
        isPending={create.isPending}
        onSubmit={onSubmit}
      />
    </div>
  );
}
