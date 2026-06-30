// Multi-step Add Provider form: collects personal, credentials, licenses,
// employment, and review; submits via createProvider service.
import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Check, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useCreateProvider } from '@/hooks/useProviders';
import { useFacilities, useProviderGroups } from '@/hooks/useLookups';
import type { ProviderInput } from '@/services/providers';

export const Route = createFileRoute('/providers/new')({
  component: Page,
});

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
] as const;

interface LicenseRow {
  state: string;
  number: string;
  type: 'full' | 'compact' | '';
  issueDate: string;
  expirationDate: string;
}

interface FormState {
  // Step 1
  firstName: string;
  lastName: string;
  credentials: string;
  dateOfBirth: string;
  ssnLast4: string;
  email: string;
  phone: string;
  homeStreet: string;
  homeCity: string;
  homeState: string;
  homeZip: string;
  // Step 2
  npi: string;
  caqhId: string;
  isNewGrad: boolean;
  caqhLastAttestedDate: string;
  taxonomyCode: string;
  deaNumber: string;
  // Step 3
  licenses: LicenseRow[];
  // Step 4
  groupId: string;
  facilityIds: string[];
  specialty: string;
  startDate: string;
  degree: string;
  schoolName: string;
  graduationDate: string;
  malpracticeCarrier: string;
  malpracticePolicyNumber: string;
  malpracticeCoverageStart: string;
  malpracticeCoverageEnd: string;
}

const STEPS = [
  { id: 1, label: 'Personal' },
  { id: 2, label: 'Credentials' },
  { id: 3, label: 'Licenses' },
  { id: 4, label: 'Employment' },
  { id: 5, label: 'Review' },
] as const;

const initial: FormState = {
  firstName: '',
  lastName: '',
  credentials: '',
  dateOfBirth: '',
  ssnLast4: '',
  email: '',
  phone: '',
  homeStreet: '',
  homeCity: '',
  homeState: '',
  homeZip: '',
  npi: '',
  caqhId: '',
  isNewGrad: false,
  caqhLastAttestedDate: '',
  taxonomyCode: '225100000X',
  deaNumber: '',
  licenses: [{ state: '', number: '', type: '', issueDate: '', expirationDate: '' }],
  groupId: '',
  facilityIds: [],
  specialty: '',
  startDate: '',
  degree: '',
  schoolName: '',
  graduationDate: '',
  malpracticeCarrier: '',
  malpracticePolicyNumber: '',
  malpracticeCoverageStart: '',
  malpracticeCoverageEnd: '',
};

type Errors = Partial<Record<string, string>>;

function validateStep(step: number, f: FormState): Errors {
  const e: Errors = {};
  if (step === 1) {
    if (f.ssnLast4 && !/^\d{4}$/.test(f.ssnLast4)) e.ssnLast4 = 'Enter exactly 4 digits';
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'Invalid email';
  }
  if (step === 2) {
    if (f.npi && !/^1\d{9}$/.test(f.npi)) e.npi = 'NPI must be 10 digits and start with 1';
    if (!f.isNewGrad && f.caqhId && !/^\d{8}$/.test(f.caqhId)) e.caqhId = 'CAQH must be 8 digits';
  }
  return e;
}

function Page() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const create = useCreateProvider();
  const groups = useProviderGroups();
  const facilities = useFacilities(form.groupId || null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
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
    const allErrors: Errors = {
      ...validateStep(1, form),
      ...validateStep(2, form),
      ...validateStep(3, form),
      ...validateStep(4, form),
    };
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      return;
    }
    const input: ProviderInput = {
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
      npi: form.npi,
      caqhId: form.isNewGrad ? null : form.caqhId || null,
      caqhLastAttestedDate: form.caqhLastAttestedDate || null,
      taxonomyCode: form.taxonomyCode.trim(),
      deaNumber: form.deaNumber.trim() || null,
      isNewGrad: form.isNewGrad,
      groupId: form.groupId,
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
    try {
      const created = await create.mutateAsync(input);
      navigate({ to: '/providers/$id', params: { id: created.id } });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create provider');
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Add provider"
        description="Enter provider details. All steps are required before submission."
        actions={
          <Button variant="outline" onClick={() => navigate({ to: '/providers' })}>
            Cancel
          </Button>
        }
      />

      <Stepper current={step} />

      <div className="mt-6 rounded-md border border-border bg-card">
        <div className="p-6">
          {step === 1 ? <Step1 form={form} update={update} errors={errors} /> : null}
          {step === 2 ? <Step2 form={form} update={update} errors={errors} /> : null}
          {step === 3 ? <Step3 form={form} setForm={setForm} errors={errors} /> : null}
          {step === 4 ? (
            <Step4
              form={form}
              update={update}
              errors={errors}
              groups={groups.data ?? []}
              facilities={facilities.data ?? []}
            />
          ) : null}
          {step === 5 ? <Step5 form={form} jumpTo={jumpTo} /> : null}

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
            <Button onClick={next} style={{ backgroundColor: '#1B4D3E' }}>
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={create.isPending} style={{ backgroundColor: '#1B4D3E' }}>
              {create.isPending ? 'Creating…' : 'Create provider'}
            </Button>
          )}
        </div>
      </div>
    </div>
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
                done
                  ? 'border-transparent text-white'
                  : active
                  ? 'border-transparent text-white'
                  : 'border-border bg-background text-muted-foreground',
              )}
              style={done || active ? { backgroundColor: '#1B4D3E' } : undefined}
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

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </label>
  );
}

function Field({
  label,
  error,
  helper,
  children,
}: {
  label: string;
  error?: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

interface StepProps {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  errors: Errors;
}

function Step1({ form, update, errors }: StepProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="First name" error={errors.firstName}>
        <Input value={form.firstName} onChange={(e) => update('firstName', e.target.value)} />
      </Field>
      <Field label="Last name" error={errors.lastName}>
        <Input value={form.lastName} onChange={(e) => update('lastName', e.target.value)} />
      </Field>
      <Field label="Credentials">
        <Input
          placeholder="PT, DPT"
          value={form.credentials}
          onChange={(e) => update('credentials', e.target.value)}
        />
      </Field>
      <Field label="Date of birth">
        <Input
          type="date"
          value={form.dateOfBirth}
          onChange={(e) => update('dateOfBirth', e.target.value)}
        />
      </Field>
      <Field
        label="SSN last 4"
        error={errors.ssnLast4}
        helper="Last 4 only — Minted Panel never stores full SSNs"
      >
        <div className="flex items-center gap-2">
          <span className="select-none font-mono text-sm text-muted-foreground">xxx-xx-</span>
          <Input
            inputMode="numeric"
            maxLength={4}
            className="w-24 font-mono"
            value={form.ssnLast4}
            onChange={(e) =>
              update('ssnLast4', e.target.value.replace(/\D/g, '').slice(0, 4))
            }
          />
        </div>
      </Field>
      <Field label="Email" error={errors.email}>
        <Input
          type="email"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
        />
      </Field>
      <Field label="Phone">
        <Input value={form.phone} onChange={(e) => update('phone', e.target.value)} />
      </Field>
      <div className="md:col-span-2">
        <Label>Home address</Label>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <Input
            className="md:col-span-3"
            placeholder="Street"
            value={form.homeStreet}
            onChange={(e) => update('homeStreet', e.target.value)}
          />
          <Input
            className="md:col-span-2"
            placeholder="City"
            value={form.homeCity}
            onChange={(e) => update('homeCity', e.target.value)}
          />
          <Select value={form.homeState} onValueChange={(v) => update('homeState', v)}>
            <SelectTrigger>
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              {US_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="md:col-span-1"
            placeholder="ZIP"
            value={form.homeZip}
            onChange={(e) => update('homeZip', e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

function Step2({ form, update, errors }: StepProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="NPI" error={errors.npi}>
        <Input
          inputMode="numeric"
          maxLength={10}
          value={form.npi}
          onChange={(e) => update('npi', e.target.value.replace(/\D/g, '').slice(0, 10))}
        />
      </Field>
      <Field label="CAQH ID" error={errors.caqhId}>
        <Input
          inputMode="numeric"
          maxLength={8}
          disabled={form.isNewGrad}
          value={form.caqhId}
          onChange={(e) => update('caqhId', e.target.value.replace(/\D/g, '').slice(0, 8))}
        />
        <label className="mt-2 flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.isNewGrad}
            onCheckedChange={(c) => {
              const v = c === true;
              update('isNewGrad', v);
              if (v) update('caqhId', '');
            }}
          />
          New grad — no CAQH yet
        </label>
      </Field>
      <Field label="CAQH last attested date">
        <Input
          type="date"
          disabled={form.isNewGrad}
          value={form.caqhLastAttestedDate}
          onChange={(e) => update('caqhLastAttestedDate', e.target.value)}
        />
      </Field>
      <Field
        label="Taxonomy code"
        error={errors.taxonomyCode}
        helper="Change if this provider uses a specialty taxonomy"
      >
        <Input
          value={form.taxonomyCode}
          onChange={(e) => update('taxonomyCode', e.target.value)}
        />
      </Field>
      <Field label="DEA number">
        <Input value={form.deaNumber} onChange={(e) => update('deaNumber', e.target.value)} />
      </Field>
    </div>
  );
}

function Step3({
  form,
  setForm,
  errors,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  errors: Errors;
}) {
  const updateRow = (i: number, patch: Partial<LicenseRow>) => {
    setForm((p) => ({
      ...p,
      licenses: p.licenses.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));
  };
  const addRow = () => {
    setForm((p) => ({
      ...p,
      licenses: [...p.licenses, { state: '', number: '', type: '', issueDate: '', expirationDate: '' }],
    }));
  };
  const removeRow = (i: number) => {
    setForm((p) => ({ ...p, licenses: p.licenses.filter((_, idx) => idx !== i) }));
  };

  return (
    <div className="space-y-4">
      {errors.licenses ? (
        <p className="text-xs text-destructive">{errors.licenses}</p>
      ) : null}
      {form.licenses.map((row, i) => (
        <div key={i} className="rounded-md border border-border p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-2">
              <Label>State</Label>
              <Select value={row.state} onValueChange={(v) => updateRow(i, { state: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="State" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors[`lic-${i}-state`] ? (
                <p className="mt-1 text-xs text-destructive">{errors[`lic-${i}-state`]}</p>
              ) : null}
            </div>
            <div className="md:col-span-3">
              <Label>License number</Label>
              <Input value={row.number} onChange={(e) => updateRow(i, { number: e.target.value })} />
              {errors[`lic-${i}-number`] ? (
                <p className="mt-1 text-xs text-destructive">{errors[`lic-${i}-number`]}</p>
              ) : null}
            </div>
            <div className="md:col-span-2">
              <Label>Type</Label>
              <Select
                value={row.type}
                onValueChange={(v) => updateRow(i, { type: v as LicenseRow['type'] })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                </SelectContent>
              </Select>
              {errors[`lic-${i}-type`] ? (
                <p className="mt-1 text-xs text-destructive">{errors[`lic-${i}-type`]}</p>
              ) : null}
            </div>
            <div className="md:col-span-2">
              <Label>Issue date</Label>
              <Input
                type="date"
                value={row.issueDate}
                onChange={(e) => updateRow(i, { issueDate: e.target.value })}
              />
              {errors[`lic-${i}-issueDate`] ? (
                <p className="mt-1 text-xs text-destructive">{errors[`lic-${i}-issueDate`]}</p>
              ) : null}
            </div>
            <div className="md:col-span-2">
              <Label>Expires</Label>
              <Input
                type="date"
                value={row.expirationDate}
                onChange={(e) => updateRow(i, { expirationDate: e.target.value })}
              />
              {errors[`lic-${i}-expirationDate`] ? (
                <p className="mt-1 text-xs text-destructive">
                  {errors[`lic-${i}-expirationDate`]}
                </p>
              ) : null}
            </div>
            <div className="flex items-end md:col-span-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeRow(i)}
                disabled={form.licenses.length === 1}
                aria-label="Remove license"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ))}
      <Button variant="outline" onClick={addRow}>
        <Plus className="h-4 w-4" />
        Add license
      </Button>
    </div>
  );
}

function Step4({
  form,
  update,
  errors,
  groups,
  facilities,
}: StepProps & {
  groups: { id: string; name: string }[];
  facilities: { id: string; name: string; groupId: string | null }[];
}) {
  const toggleFacility = (id: string) => {
    const next = form.facilityIds.includes(id)
      ? form.facilityIds.filter((f) => f !== id)
      : [...form.facilityIds, id];
    update('facilityIds', next);
  };
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="Group" error={errors.groupId}>
        <Select
          value={form.groupId}
          onValueChange={(v) => {
            update('groupId', v);
            update('facilityIds', []);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select group" />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Specialty">
        <Input value={form.specialty} onChange={(e) => update('specialty', e.target.value)} />
      </Field>
      <div className="md:col-span-2">
        <Label>Facilities</Label>
        {!form.groupId ? (
          <p className="text-xs text-muted-foreground">Select a group to choose facilities.</p>
        ) : facilities.length === 0 ? (
          <p className="text-xs text-muted-foreground">No facilities for this group.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {facilities.map((f) => (
              <label
                key={f.id}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <Checkbox
                  checked={form.facilityIds.includes(f.id)}
                  onCheckedChange={() => toggleFacility(f.id)}
                />
                {f.name}
              </label>
            ))}
          </div>
        )}
      </div>
      <Field label="Start date" error={errors.startDate}>
        <Input
          type="date"
          value={form.startDate}
          onChange={(e) => update('startDate', e.target.value)}
        />
      </Field>
      <Field label="Degree">
        <Input value={form.degree} onChange={(e) => update('degree', e.target.value)} />
      </Field>
      <Field label="School">
        <Input value={form.schoolName} onChange={(e) => update('schoolName', e.target.value)} />
      </Field>
      <Field label="Graduation date">
        <Input
          type="date"
          value={form.graduationDate}
          onChange={(e) => update('graduationDate', e.target.value)}
        />
      </Field>
      <Field label="Malpractice carrier">
        <Input
          value={form.malpracticeCarrier}
          onChange={(e) => update('malpracticeCarrier', e.target.value)}
        />
      </Field>
      <Field label="Policy number">
        <Input
          value={form.malpracticePolicyNumber}
          onChange={(e) => update('malpracticePolicyNumber', e.target.value)}
        />
      </Field>
      <Field label="Coverage start">
        <Input
          type="date"
          value={form.malpracticeCoverageStart}
          onChange={(e) => update('malpracticeCoverageStart', e.target.value)}
        />
      </Field>
      <Field label="Coverage end">
        <Input
          type="date"
          value={form.malpracticeCoverageEnd}
          onChange={(e) => update('malpracticeCoverageEnd', e.target.value)}
        />
      </Field>
    </div>
  );
}

function Step5({ form, jumpTo }: { form: FormState; jumpTo: (s: number) => void }) {
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

  return (
    <div className="space-y-4">
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
              {l.state} · {l.number} · {l.type} · {l.issueDate} → {l.expirationDate}
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
