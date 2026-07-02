// Single-page Edit Provider form used by /providers/$id/edit. Renders the same
// four sections as the Add stepper, stacked with no wizard chrome.
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  CredentialsSection,
  EmploymentSection,
  LicensesSection,
  PersonalSection,
} from '@/components/providers/ProviderFormSections';
import {
  validateAll,
  type ProviderFormErrors,
  type ProviderFormState,
  type UpdateProviderField,
} from '@/components/providers/providerFormShared';

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
  const [errors, setErrors] = useState<ProviderFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const update: UpdateProviderField = (key, value) => {
    setForm((p) => ({ ...p, [key]: value }));
  };

  const submit = async () => {
    setSubmitError(null);
    const e = validateAll(form);
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
        <PersonalSection form={form} errors={errors} update={update} />
      </Section>
      <Section title="Credentials">
        <CredentialsSection form={form} errors={errors} update={update} />
      </Section>
      <Section title="Licenses">
        <LicensesSection form={form} errors={errors} update={update} />
      </Section>
      <Section title="Employment & Malpractice">
        <EmploymentSection form={form} errors={errors} update={update} />
      </Section>

      {submitError ? (
        <p className="text-sm text-destructive">{submitError}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={isPending}>
          {isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
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
