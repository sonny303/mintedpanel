// Add Provider entry point. The 5-step form lives in ProviderForm; this
// route wires it to the createProvider mutation. Billing users are redirected
// before the page renders.
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { useCreateProvider } from '@/hooks/useProviders';
import { useAuthStore } from '@/lib/auth-store';
import {
  ProviderForm,
  emptyProviderFormState,
  type ProviderFormState,
} from '@/components/providers/ProviderForm';
import type { ProviderInput } from '@/services/providers';

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

function toInput(form: ProviderFormState): ProviderInput {
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

function Page() {
  const navigate = useNavigate();
  const create = useCreateProvider();

  const onSubmit = async (form: ProviderFormState) => {
    const created = await create.mutateAsync(toInput(form));
    navigate({ to: '/providers/$id', params: { id: created.id } });
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
