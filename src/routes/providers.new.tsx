// Add Provider entry point. The 5-step form lives in ProviderForm; this
// route wires it to createProviderWithDetails so licenses and facility
// assignments captured in steps 3 and 4 are persisted alongside the provider.
// A ?locationId search param (set by the launch flow) pre-selects the launch
// location's group and facility so onboarding and the launch run in parallel.
import { useEffect, useMemo } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { useActiveOrgId, useAuthStore, useRole } from "@/lib/auth-store";
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
    homeStreet: form.homeStreet.trim() || null,
    homeCity: form.homeCity.trim() || null,
    homeState: form.homeState || null,
    homeZip: form.homeZip.trim() || null,
    npi: form.npi || null,
    caqhId: form.isNewGrad ? null : form.caqhId || null,
    caqhLastAttestedDate: form.caqhLastAttestedDate || null,
    taxonomyCode: form.taxonomyCode.trim() || null,
    deaNumber: form.deaNumber.trim() || null,
    isNewGrad: form.isNewGrad,
    groupId: form.groupId || null,
    specialty: form.specialty.trim() || null,
    startDate: form.startDate || null,
    degree: form.degree.trim() || null,
    schoolName: form.schoolName.trim() || null,
    graduationDate: form.graduationDate || null,
    malpracticeCarrier: form.malpracticeCarrier.trim() || null,
    malpracticePolicyNumber: form.malpracticePolicyNumber.trim() || null,
    malpracticeCoverageStart: form.malpracticeCoverageStart || null,
    malpracticeCoverageEnd: form.malpracticeCoverageEnd || null,
    status: "active",
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
      const result: CreateProviderWithDetailsResult = await create.mutateAsync({
        provider: toProviderInput(form),
        licenses: toLicenseInputs(form),
        facilityIds: form.facilityIds,
      });
      if (result.warnings.length > 0) {
        for (const w of result.warnings) toast.error(w);
        toast.warning("Provider created, but some details did not save. Fix and retry.");
        return;
      }
      if (launchLocation && form.facilityIds.includes(launchLocation.id)) {
        toast.success(`Provider added and linked to ${launchLocation.name}`);
        navigate({ to: "/launches/$id", params: { id: launchLocation.id } });
        return;
      }
      toast.success("Provider added");
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
            ? `Linked to launch ${launchLocation.name} on save. All fields are optional.`
            : "Enter provider details. All fields are optional — save with as little or as much as you have."
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
