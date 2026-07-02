// Add Provider entry point. The 5-step form lives in ProviderForm; this
// route wires it to createProviderWithDetails so licenses and facility
// assignments captured in steps 3 and 4 are persisted alongside the provider.
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { useActiveOrgId, useAuthStore } from '@/lib/auth-store';
import {
  ProviderForm,
  emptyProviderFormState,
  type ProviderFormState,
} from '@/components/providers/ProviderForm';
import {
  createProviderWithDetails,
  type CreateProviderWithDetailsInput,
  type CreateProviderWithDetailsResult,
  type LicenseInput,
  type ProviderInput,
} from '@/services/providers';

export const Route = createFileRoute('/providers/new')({
  beforeLoad: () => {
    const { memberships, activeOrgId } = useAuthStore.getState();
    const role = memberships.find((m) => m.orgId === activeOrgId)?.role ?? null;
    if (role === 'billing') {
      throw redirect({ to: '/providers', replace: true });
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
    status: 'active',
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
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';

  const create = useMutation({
    mutationFn: (input: CreateProviderWithDetailsInput) => createProviderWithDetails(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers', orgId] });
    },
  });

  const onSubmit = async (form: ProviderFormState) => {
    try {
      const result: CreateProviderWithDetailsResult = await create.mutateAsync({
        provider: toProviderInput(form),
        licenses: toLicenseInputs(form),
        facilityIds: form.facilityIds,
      });
      if (result.warnings.length > 0) {
        for (const w of result.warnings) toast.error(w);
        toast.warning('Provider created, but some details did not save. Fix and retry.');
        return;
      }
      toast.success('Provider added');
      navigate({ to: '/providers/$id', params: { id: result.provider.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create provider');
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Add provider"
        description="Enter provider details. All fields are optional — save with as little or as much as you have."
      />
      <ProviderForm
        initial={emptyProviderFormState}
        submitLabel="Create provider"
        pendingLabel="Creating…"
        isPending={create.isPending}
        onSubmit={onSubmit}
      />
    </div>
  );
}
