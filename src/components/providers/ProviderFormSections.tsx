// Four field-section bodies shared by the Add stepper and single-page Edit.
// Each takes (form, errors, update); Licenses/Employment also mutate arrays via update.
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldLabel } from "@/components/providers/FormField";

import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import {
  US_STATES,
  emptyLicenseRow,
  type LicenseRow,
  type ProviderFormErrors,
  type ProviderFormState,
  type UpdateProviderField,
} from "@/components/providers/providerFormShared";
import { taxonomyOptionsForValue } from "@/lib/providerTaxonomy";

interface SectionProps {
  form: ProviderFormState;
  errors: ProviderFormErrors;
  update: UpdateProviderField;
}

export function PersonalSection({ form, errors, update }: SectionProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="First name" error={errors.firstName}>
        <Input value={form.firstName} onChange={(e) => update("firstName", e.target.value)} />
      </Field>
      <Field label="Last name" error={errors.lastName}>
        <Input value={form.lastName} onChange={(e) => update("lastName", e.target.value)} />
      </Field>
      <Field label="Credentials">
        <Input
          placeholder="PT, DPT"
          value={form.credentials}
          onChange={(e) => update("credentials", e.target.value)}
        />
      </Field>
      <Field label="Date of birth">
        <Input
          type="date"
          value={form.dateOfBirth}
          onChange={(e) => update("dateOfBirth", e.target.value)}
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
            onChange={(e) => update("ssnLast4", e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </div>
      </Field>
      <Field label="Email" error={errors.email}>
        <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
      </Field>
      <Field label="Phone">
        <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
      </Field>
    </div>
  );
}

export function CredentialsSection({ form, errors, update }: SectionProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="NPI" error={errors.npi}>
        <Input
          inputMode="numeric"
          maxLength={10}
          value={form.npi}
          onChange={(e) => update("npi", e.target.value.replace(/\D/g, "").slice(0, 10))}
        />
      </Field>
      <Field label="CAQH ID" error={errors.caqhId}>
        <Input
          inputMode="numeric"
          maxLength={8}
          disabled={form.isNewGrad}
          value={form.caqhId}
          onChange={(e) => update("caqhId", e.target.value.replace(/\D/g, "").slice(0, 8))}
        />
        <label className="mt-2 flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.isNewGrad}
            onCheckedChange={(c) => {
              const v = c === true;
              update("isNewGrad", v);
              if (v) update("caqhId", "");
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
          onChange={(e) => update("caqhLastAttestedDate", e.target.value)}
        />
      </Field>
      <Field
        label="Taxonomy code"
        error={errors.taxonomyCode}
        helper="NUCC taxonomy for this provider's specialty"
      >
        <Select
          value={form.taxonomyCode || undefined}
          onValueChange={(v) => update("taxonomyCode", v)}
        >
          <SelectTrigger aria-label="Taxonomy code">
            <SelectValue placeholder="Select taxonomy" />
          </SelectTrigger>
          <SelectContent>
            {taxonomyOptionsForValue(form.taxonomyCode).map(({ code, label }) => (
              <SelectItem key={code} value={code}>
                <span className="font-mono text-[13px]">{code}</span>
                <span className="text-muted-foreground"> — {label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

export function LicensesSection({ form, errors, update }: SectionProps) {
  const updateRow = (i: number, patch: Partial<LicenseRow>) => {
    update(
      "licenses",
      form.licenses.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
  };
  const addRow = () => {
    update("licenses", [...form.licenses, emptyLicenseRow()]);
  };
  const removeRow = (i: number) => {
    update(
      "licenses",
      form.licenses.filter((_, idx) => idx !== i),
    );
  };

  return (
    <div className="space-y-4">
      {errors.licenses ? <p className="text-xs text-destructive">{errors.licenses}</p> : null}
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
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
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
                onValueChange={(v) => updateRow(i, { type: v as LicenseRow["type"] })}
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
  );
}

export function EmploymentSection({ form, errors, update }: SectionProps) {
  const groups = useProviderGroups();
  const facilities = useFacilities(form.groupId || null);

  const toggleFacility = (id: string) => {
    const next = form.facilityIds.includes(id)
      ? form.facilityIds.filter((f) => f !== id)
      : [...form.facilityIds, id];
    update("facilityIds", next);
  };

  const facilityList = facilities.data ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="Group" error={errors.groupId}>
        <Select
          value={form.groupId}
          onValueChange={(v) => {
            update("groupId", v);
            update("facilityIds", []);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select group" />
          </SelectTrigger>
          <SelectContent>
            {(groups.data ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Specialty">
        <Input value={form.specialty} onChange={(e) => update("specialty", e.target.value)} />
      </Field>
      <div className="md:col-span-2">
        <FieldLabel>Facilities</FieldLabel>
        {!form.groupId ? (
          <p className="text-xs text-muted-foreground">Select a group to choose facilities.</p>
        ) : facilityList.length === 0 ? (
          <p className="text-xs text-muted-foreground">No facilities for this group.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {facilityList.map((f) => (
              <label
                key={f.id}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <Checkbox
                  checked={form.facilityIds.includes(f.id)}
                  onCheckedChange={() => toggleFacility(f.id)}
                />
                <span>{f.name}</span>
                {form.facilityIds[0] === f.id ? (
                  <span className="ml-auto text-[11px] uppercase tracking-wide text-muted-foreground">
                    Primary
                  </span>
                ) : null}
              </label>
            ))}
          </div>
        )}
      </div>
      <Field label="Start date" error={errors.startDate}>
        <Input
          type="date"
          value={form.startDate}
          onChange={(e) => update("startDate", e.target.value)}
        />
      </Field>
      <Field label="Degree">
        <Input value={form.degree} onChange={(e) => update("degree", e.target.value)} />
      </Field>
      <Field label="School">
        <Input value={form.schoolName} onChange={(e) => update("schoolName", e.target.value)} />
      </Field>
      <Field label="Graduation date">
        <Input
          type="date"
          value={form.graduationDate}
          onChange={(e) => update("graduationDate", e.target.value)}
        />
      </Field>
    </div>
  );
}
