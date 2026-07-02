// Multi-step Add Provider form used by /providers/new. Re-exports shared
// types/state for legacy import sites; the Edit flow lives in EditProviderForm.tsx.
import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useFacilities, useProviderGroups } from '@/hooks/useLookups';
import {
  CredentialsSection,
  EmploymentSection,
  LicensesSection,
  PersonalSection,
} from '@/components/providers/ProviderFormSections';
import {
  validateAll,
  validateCredentials,
  validatePersonal,
  type ProviderFormErrors,
  type ProviderFormState,
  type UpdateProviderField,
} from '@/components/providers/providerFormShared';

export {
  emptyProviderFormState,
  type LicenseRow,
  type ProviderFormState,
} from '@/components/providers/providerFormShared';

const STEPS = [
  { id: 1, label: 'Personal' },
  { id: 2, label: 'Credentials' },
  { id: 3, label: 'Licenses' },
  { id: 4, label: 'Employment' },
  { id: 5, label: 'Review' },
] as const;

function validateStep(step: number, f: ProviderFormState): ProviderFormErrors {
  if (step === 1) return validatePersonal(f);
  if (step === 2) return validateCredentials(f);
  return {};
}

export interface ProviderFormProps {
  initial: ProviderFormState;
  submitLabel: string;
  pendingLabel: string;
  isPending: boolean;
  onSubmit: (form: ProviderFormState) => Promise<void>;
  onCancel?: () => void;
}

export function ProviderForm({
  initial,
  submitLabel,
  pendingLabel,
  isPending,
  onSubmit,
  onCancel,
}: ProviderFormProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<ProviderFormState>(initial);
  const [errors, setErrors] = useState<ProviderFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const update: UpdateProviderField = (key, value) => {
    setForm((p) => ({ ...p, [key]: value }));
  };

  const next = () => {
    const e = validateStep(step, form);
    setErrors(e);
    if (Object.keys(e).length === 0) setStep((s) => Math.min(5, s + 1));
  };
  const back = () => {
    setErrors({});
    setStep((s) => Math.max(1, s - 1));
  };
  const jumpTo = (s: number) => {
    setErrors({});
    setStep(s);
  };

  const submit = async () => {
    setSubmitError(null);
    const allErrors = validateAll(form);
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      // Jump back to the first step with an error so the user sees it.
      if (allErrors.firstName || allErrors.lastName || allErrors.ssnLast4 || allErrors.email) {
        setStep(1);
      } else if (allErrors.npi || allErrors.caqhId) {
        setStep(2);
      }
      return;
    }
    try {
      await onSubmit(form);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save provider');
    }
  };

  const handleCancel = onCancel ?? (() => navigate({ to: '/providers' }));

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="outline" onClick={handleCancel}>Cancel</Button>
      </div>
      <Stepper current={step} />
      <div className="mt-6 rounded-md border border-border bg-card">
        <div className="p-6">
          {step === 1 ? <PersonalSection form={form} errors={errors} update={update} /> : null}
          {step === 2 ? <CredentialsSection form={form} errors={errors} update={update} /> : null}
          {step === 3 ? <LicensesSection form={form} errors={errors} update={update} /> : null}
          {step === 4 ? <EmploymentSection form={form} errors={errors} update={update} /> : null}
          {step === 5 ? <ReviewStep form={form} jumpTo={jumpTo} /> : null}

          {submitError ? (
            <p className="mt-4 text-sm text-destructive">{submitError}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button variant="outline" onClick={back} disabled={step === 1}>
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          {step < 5 ? (
            <Button onClick={next}>
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={isPending}>
              {isPending ? pendingLabel : submitLabel}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const done = current > s.id;
        const active = current === s.id;
        return (
          <li key={s.id} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium',
                done || active
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground',
              )}
            >
              {done ? <Check className="h-4 w-4" /> : s.id}
            </div>
            <span
              className={cn(
                'text-xs font-medium uppercase tracking-wider',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 ? (
              <div className="mx-2 h-px flex-1 bg-border" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ReviewStep({
  form,
  jumpTo,
}: {
  form: ProviderFormState;
  jumpTo: (s: number) => void;
}) {
  const groups = useProviderGroups();
  const facilities = useFacilities(form.groupId || null);
  const groupName = useMemo(
    () => groups.data?.find((g) => g.id === form.groupId)?.name ?? '—',
    [groups.data, form.groupId],
  );
  const facilityNames = useMemo(
    () =>
      (facilities.data ?? [])
        .filter((f) => form.facilityIds.includes(f.id))
        .map((f) => f.name)
        .join(', ') || '—',
    [facilities.data, form.facilityIds],
  );

  const Section = ({
    title,
    step,
    children,
  }: {
    title: string;
    step: number;
    children: React.ReactNode;
  }) => (
    <section className="rounded-md border border-border">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <button
          type="button"
          onClick={() => jumpTo(step)}
          className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
        >
          Edit
        </button>
      </header>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 p-4 md:grid-cols-2">{children}</dl>
    </section>
  );

  const Row = ({ label, value }: { label: string; value: string | null }) => (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value && value.length > 0 ? value : '—'}</dd>
    </div>
  );

  const displayName = `${form.firstName} ${form.lastName}`.trim() || 'Unnamed provider';

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Review
        </p>
        <p className="mt-1 text-sm font-medium text-foreground">{displayName}</p>
      </div>
      <Section title="Personal" step={1}>
        <Row label="Name" value={`${form.firstName} ${form.lastName}`.trim()} />
        <Row label="Credentials" value={form.credentials} />
        <Row label="Date of birth" value={form.dateOfBirth} />
        <Row label="SSN" value={form.ssnLast4 ? `xxx-xx-${form.ssnLast4}` : null} />
        <Row label="Email" value={form.email} />
        <Row label="Phone" value={form.phone} />
        <Row
          label="Home address"
          value={[form.homeStreet, form.homeCity, form.homeState, form.homeZip]
            .filter(Boolean)
            .join(', ')}
        />
      </Section>
      <Section title="Credentials" step={2}>
        <Row label="NPI" value={form.npi} />
        <Row label="CAQH ID" value={form.isNewGrad ? 'New grad' : form.caqhId} />
        <Row label="CAQH attested" value={form.caqhLastAttestedDate} />
        <Row label="Taxonomy" value={form.taxonomyCode} />
        <Row label="DEA" value={form.deaNumber} />
      </Section>
      <Section title="Licenses" step={3}>
        <div className="md:col-span-2 space-y-1">
          {form.licenses.map((l, i) => (
            <div key={i} className="text-sm text-foreground">
              {l.state || '—'} · {l.number || '—'} · {l.type || '—'} · {l.issueDate || '—'} → {l.expirationDate || '—'}
            </div>
          ))}
        </div>
      </Section>
      <Section title="Employment & Malpractice" step={4}>
        <Row label="Group" value={groupName} />
        <Row label="Facilities" value={facilityNames} />
        <Row label="Specialty" value={form.specialty} />
        <Row label="Start date" value={form.startDate} />
        <Row label="Degree" value={form.degree} />
        <Row label="School" value={form.schoolName} />
        <Row label="Graduation" value={form.graduationDate} />
        <Row label="Carrier" value={form.malpracticeCarrier} />
        <Row label="Policy" value={form.malpracticePolicyNumber} />
        <Row
          label="Coverage"
          value={
            form.malpracticeCoverageStart || form.malpracticeCoverageEnd
              ? `${form.malpracticeCoverageStart || '—'} → ${form.malpracticeCoverageEnd || '—'}`
              : null
          }
        />
      </Section>
    </div>
  );
}
