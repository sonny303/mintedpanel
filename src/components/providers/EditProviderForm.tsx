// Single-page Edit Provider form. Sections rendered inline, no stepper.
// All fields optional except first/last name. Used only by /providers/$id/edit.
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
import { useFacilities, useProviderGroups } from '@/hooks/useLookups';
import type {
  LicenseRow,
  ProviderFormState,
} from '@/components/providers/ProviderForm';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
] as const;

type Errors = Partial<Record<string, string>>;

function validate(f: ProviderFormState): Errors {
  const e: Errors = {};
  if (!f.firstName.trim()) e.firstName = 'Required';
  if (!f.lastName.trim()) e.lastName = 'Required';
  if (f.ssnLast4 && !/^\d{4}$/.test(f.ssnLast4)) e.ssnLast4 = 'Enter exactly 4 digits';
  if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'Invalid email';
  if (f.npi && !/^1\d{9}$/.test(f.npi)) e.npi = 'NPI must be 10 digits and start with 1';
  if (!f.isNewGrad && f.caqhId && !/^\d{8}$/.test(f.caqhId)) e.caqhId = 'CAQH must be 8 digits';
  return e;
}

export interface EditProviderFormProps {
  initial: ProviderFormState;
  isPending: boolean;
  onSubmit: (form: ProviderFormState) => Promise<void>;
  onCancel: () => void;
}

export function EditProviderForm({
  initial,
  isPending,
  onSubmit,
  onCancel,
}: EditProviderFormProps) {
  const [form, setForm] = useState<ProviderFormState>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const groups = useProviderGroups();
  const facilities = useFacilities(form.groupId || null);

  const update = <K extends keyof ProviderFormState>(key: K, value: ProviderFormState[K]) => {
    setForm((p) => ({ ...p, [key]: value }));
  };

  const updateRow = (i: number, patch: Partial<LicenseRow>) => {
    setForm((p) => ({
      ...p,
      licenses: p.licenses.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));
  };
  const addRow = () => {
    setForm((p) => ({
      ...p,
      licenses: [
        ...p.licenses,
        { state: '', number: '', type: '', issueDate: '', expirationDate: '' },
      ],
    }));
  };
  const removeRow = (i: number) => {
    setForm((p) => ({ ...p, licenses: p.licenses.filter((_, idx) => idx !== i) }));
  };

  const toggleFacility = (id: string) => {
    const next = form.facilityIds.includes(id)
      ? form.facilityIds.filter((f) => f !== id)
      : [...form.facilityIds, id];
    update('facilityIds', next);
  };

  const submit = async () => {
    setSubmitError(null);
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    try {
      await onSubmit(form);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save provider');
    }
  };

  return (
    <div className="space-y-6">
      <Section title="Personal">
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
            helper="Last 4 only — never store full SSNs"
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
            <FieldLabel>Home address</FieldLabel>
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
                    <SelectItem key={s} value={s}>{s}</SelectItem>
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
      </Section>

      <Section title="Credentials">
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
          <Field label="Taxonomy code">
            <Input
              value={form.taxonomyCode}
              onChange={(e) => update('taxonomyCode', e.target.value)}
            />
          </Field>
          <Field label="DEA number">
            <Input value={form.deaNumber} onChange={(e) => update('deaNumber', e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Licenses">
        <div className="space-y-4">
          {form.licenses.map((row, i) => (
            <div key={i} className="rounded-md border border-border p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-2">
                  <FieldLabel>State</FieldLabel>
                  <Select value={row.state} onValueChange={(v) => updateRow(i, { state: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="State" />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-3">
                  <FieldLabel>License number</FieldLabel>
                  <Input
                    value={row.number}
                    onChange={(e) => updateRow(i, { number: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <FieldLabel>Type</FieldLabel>
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
                </div>
                <div className="md:col-span-2">
                  <FieldLabel>Issue date</FieldLabel>
                  <Input
                    type="date"
                    value={row.issueDate}
                    onChange={(e) => updateRow(i, { issueDate: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <FieldLabel>Expires</FieldLabel>
                  <Input
                    type="date"
                    value={row.expirationDate}
                    onChange={(e) => updateRow(i, { expirationDate: e.target.value })}
                  />
                </div>
                <div className="flex items-end md:col-span-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(i)}
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
      </Section>

      <Section title="Employment & Malpractice">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Group">
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
                {(groups.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Specialty">
            <Input value={form.specialty} onChange={(e) => update('specialty', e.target.value)} />
          </Field>
          <div className="md:col-span-2">
            <FieldLabel>Facilities</FieldLabel>
            {!form.groupId ? (
              <p className="text-xs text-muted-foreground">Select a group to choose facilities.</p>
            ) : (facilities.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No facilities for this group.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {(facilities.data ?? []).map((f) => (
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
          <Field label="Start date">
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
            <Input
              value={form.schoolName}
              onChange={(e) => update('schoolName', e.target.value)}
            />
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
      </Section>

      {submitError ? (
        <p className="text-sm text-destructive">{submitError}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={isPending} style={{ backgroundColor: '#1B4D3E' }}>
          {isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card">
      <header className="border-b border-border px-4 py-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
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
      <FieldLabel>{label}</FieldLabel>
      {children}
      {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
