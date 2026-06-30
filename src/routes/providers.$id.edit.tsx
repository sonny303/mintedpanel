// Edit Provider page: pre-fills the shared 5-step form with the existing
// provider and licenses, saves via updateProviderWithLicenses. Billing role
// is redirected back to the read-only detail view.
import { useEffect, useMemo } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useProvider, useUpdateProviderWithLicenses } from '@/hooks/useProviders';
import { useStateLicensesByProvider } from '@/hooks/useLookups';
import { useRole } from '@/lib/auth-store';
import {
  ProviderForm,
  emptyProviderFormState,
  type ProviderFormState,
  type LicenseRow,
} from '@/components/providers/ProviderForm';
import type { LicenseInput } from '@/services/providers';

export const Route = createFileRoute('/providers/$id/edit')({
  component: EditPage,
});

function EditPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const role = useRole();
  const providerQ = useProvider(id);
  const licensesQ = useStateLicensesByProvider(id);
  const update = useUpdateProviderWithLicenses(id);

  useEffect(() => {
    if (role === 'billing') {
      navigate({ to: '/providers/$id', params: { id }, replace: true });
    }
  }, [role, id, navigate]);

  const initial: ProviderFormState | null = useMemo(() => {
    const p = providerQ.data;
    if (!p) return null;
    const licenses: LicenseRow[] = (licensesQ.data ?? []).map((l) => ({
      state: l.state ?? '',
      number: l.licenseNumber ?? '',
      type:
        l.licenseType === 'full' || l.licenseType === 'compact' ? l.licenseType : '',
      issueDate: l.issueDate ?? '',
      expirationDate: l.expirationDate ?? '',
    }));
    return {
      ...emptyProviderFormState,
      firstName: p.firstName ?? '',
      lastName: p.lastName ?? '',
      credentials: p.credentials ?? '',
      dateOfBirth: p.dateOfBirth ?? '',
      ssnLast4: p.ssnLast4 ?? '',
      email: p.email ?? '',
      phone: p.phone ?? '',
      homeStreet: p.homeStreet ?? '',
      homeCity: p.homeCity ?? '',
      homeState: p.homeState ?? '',
      homeZip: p.homeZip ?? '',
      npi: p.npi ?? '',
      caqhId: p.caqhId ?? '',
      isNewGrad: p.isNewGrad ?? false,
      caqhLastAttestedDate: p.caqhLastAttestedDate ?? '',
      taxonomyCode: p.taxonomyCode ?? '',
      deaNumber: p.deaNumber ?? '',
      licenses: licenses.length > 0 ? licenses : emptyProviderFormState.licenses,
      groupId: p.groupId ?? '',
      facilityIds: [],
      specialty: p.specialty ?? '',
      startDate: p.startDate ?? '',
      degree: p.degree ?? '',
      schoolName: p.schoolName ?? '',
      graduationDate: p.graduationDate ?? '',
      malpracticeCarrier: p.malpracticeCarrier ?? '',
      malpracticePolicyNumber: p.malpracticePolicyNumber ?? '',
      malpracticeCoverageStart: p.malpracticeCoverageStart ?? '',
      malpracticeCoverageEnd: p.malpracticeCoverageEnd ?? '',
    };
  }, [providerQ.data, licensesQ.data]);

  const onSubmit = async (form: ProviderFormState) => {
    const licenses: LicenseInput[] = form.licenses.map((l) => ({
      state: l.state,
      licenseNumber: l.number.trim() || null,
      licenseType: l.type || null,
      issueDate: l.issueDate || null,
      expirationDate: l.expirationDate || null,
    }));
    await update.mutateAsync({
      patch: {
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
      },
      licenses,
    });
    toast.success('Provider updated');
    navigate({ to: '/providers/$id', params: { id }, search: { saved: 1 } as never });
  };

  if (role === 'billing') return null;

  if (providerQ.isLoading || licensesQ.isLoading || !initial) {
    return (
      <div className="max-w-4xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (providerQ.error) {
    return <p className="text-sm text-destructive">Failed to load provider.</p>;
  }

  const name = `${initial.firstName} ${initial.lastName}`.trim() || 'provider';

  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${name}`} description="Update provider details." />
      <ProviderForm
        initial={initial}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        isPending={update.isPending}
        onSubmit={onSubmit}
        onCancel={() => navigate({ to: '/providers/$id', params: { id } })}
      />
    </div>
  );
}
