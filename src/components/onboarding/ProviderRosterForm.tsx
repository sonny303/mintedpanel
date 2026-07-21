// Provider form dialog (E1.3 F1.3.1) — the CAQH-anchored baseline over the
// EXISTING providers columns. Group assignment is step one (required, M:N,
// one primary). Required to save: name, Type 1 NPI (10-digit format-only),
// ≥1 group assignment; every other CAQH field is optional (readiness — E1.8
// — is the gate, not entry). SSN is captured as LAST-4 ONLY (hard rule; the
// full-SSN vault is R6/R7). No status picker — new providers default to
// `onboarding`. Work history / disclosures are NOT captured (CAQH
// attestation is the proxy). Licenses + PSV ride the same save.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { GroupAssignmentPicker } from "@/components/onboarding/GroupAssignmentPicker";
import { LicenseListEditor } from "@/components/onboarding/LicenseListEditor";
import { EMPTY_LICENSE_DRAFT, type LicenseDraft } from "@/components/onboarding/licenseDraft";
import { useProvider, useProviderGroupAssignments } from "@/hooks/useProviders";
import { useStateLicensesByProvider } from "@/hooks/useLookups";
import { useCreateProviderWithDetails, useUpdateProviderWithLicenses } from "@/hooks/useProviders";
import { useCreateEnrollmentFact } from "@/hooks/useEnrollmentFacts";
import { usePayers } from "@/hooks/useAdmin";
import { StateSelect } from "@/components/StateSelect";
import { ENROLLMENT_GUARD_TEXT } from "@/components/providers/EnrollmentsPanel";
import { isValidNpi } from "@/lib/providerGroup";
import { validateGroupAssignments, type GroupAssignmentInput } from "@/lib/groupAssignments";
import type { LicenseInput, ProviderInput } from "@/services/providers";
import type { Provider, ProviderGroup } from "@/types";

interface RosterFormErrors {
  firstName?: string;
  lastName?: string;
  npi?: string;
  ssnLast4?: string;
  assignments?: string;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-[12px] text-[#B91C1C]">{message}</p>;
}

interface RosterFormState {
  firstName: string;
  lastName: string;
  credentials: string;
  gender: string;
  dateOfBirth: string;
  ssnLast4: string;
  email: string;
  phone: string;
  npi: string;
  taxonomyCode: string;
  specialty: string;
  startDate: string;
  degree: string;
  schoolName: string;
  graduationDate: string;
  caqhId: string;
  caqhLastAttestedDate: string;
}

const EMPTY_FORM: RosterFormState = {
  firstName: "",
  lastName: "",
  credentials: "",
  gender: "__none__",
  dateOfBirth: "",
  ssnLast4: "",
  email: "",
  phone: "",
  npi: "",
  taxonomyCode: "",
  specialty: "",
  startDate: "",
  degree: "",
  schoolName: "",
  graduationDate: "",
  caqhId: "",
  caqhLastAttestedDate: "",
};

const t = (v: string): string | null => v.trim() || null;

function toProviderInput(f: RosterFormState): Omit<ProviderInput, "firstName" | "lastName"> & {
  firstName: string;
  lastName: string;
} {
  return {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    credentials: t(f.credentials),
    gender: f.gender === "__none__" ? null : f.gender,
    dateOfBirth: t(f.dateOfBirth),
    ssnLast4: t(f.ssnLast4),
    email: t(f.email),
    phone: t(f.phone),
    // Home address is deliberately absent (user request 2026-07-19): the
    // dialog no longer captures it, and omitting the keys means an edit-mode
    // save never touches the columns — the provider record's inline fields
    // and the CSV import remain the address writers.
    npi: f.npi.replace(/\D/g, "") || null,
    taxonomyCode: t(f.taxonomyCode),
    specialty: t(f.specialty),
    startDate: t(f.startDate),
    degree: t(f.degree),
    schoolName: t(f.schoolName),
    graduationDate: t(f.graduationDate),
    // Malpractice moved to the GROUP form (group_insurance_policies, user
    // request 2026-07-19); omitting the keys means saves never touch the
    // legacy provider malpractice columns.
    caqhId: t(f.caqhId),
    caqhLastAttestedDate: t(f.caqhLastAttestedDate),
  };
}

function licenseDraftsToInputs(drafts: LicenseDraft[]): LicenseInput[] {
  return drafts
    .filter((d) => d.state.trim())
    .map((d) => ({
      id: d.id ?? null,
      state: d.state,
      licenseNumber: t(d.licenseNumber),
      licenseType: t(d.licenseType),
      issueDate: t(d.issueDate),
      expirationDate: t(d.expirationDate),
      verifiedStatus: d.verifiedStatus,
      verificationSourceUrl: t(d.verificationSourceUrl),
    }));
}

function FormBody({
  provider,
  groups,
  initialForm,
  initialLicenses,
  initialAssignments,
  onClose,
}: {
  provider: Provider | null;
  groups: ProviderGroup[];
  initialForm: RosterFormState;
  initialLicenses: LicenseDraft[];
  initialAssignments: GroupAssignmentInput[];
  onClose: () => void;
}) {
  const [form, setForm] = useState<RosterFormState>(initialForm);
  const [licenses, setLicenses] = useState<LicenseDraft[]>(initialLicenses);
  const [assignments, setAssignments] = useState<GroupAssignmentInput[]>(initialAssignments);
  const [errors, setErrors] = useState<RosterFormErrors>({});
  const [licenseErrors, setLicenseErrors] = useState<Record<number, string>>({});
  // E6.4 F6.4.4 — create-mode capture of migration enrollment FACTS (under
  // the PRIMARY group's contract; never a case). Edit mode manages facts on
  // the record's Enrollments panel instead.
  const [enrollmentDrafts, setEnrollmentDrafts] = useState<
    { payerId: string; state: string; effectiveDate: string }[]
  >([]);
  const payersQ = usePayers();
  const createFact = useCreateEnrollmentFact();

  const createMut = useCreateProviderWithDetails();
  const updateMut = useUpdateProviderWithLicenses(provider?.id ?? "");
  const pending = createMut.isPending || updateMut.isPending;

  const set = (patch: Partial<RosterFormState>) => setForm((f) => ({ ...f, ...patch }));

  const handleSave = () => {
    const next: RosterFormErrors = {};
    if (!form.firstName.trim()) next.firstName = "First name is required";
    if (!form.lastName.trim()) next.lastName = "Last name is required";
    if (!form.npi.trim()) next.npi = "Type 1 NPI is required";
    else if (!isValidNpi(form.npi)) next.npi = "NPI must be 10 digits";
    if (form.ssnLast4.trim() && !/^\d{4}$/.test(form.ssnLast4.trim()))
      next.ssnLast4 = "Enter the LAST 4 digits only";
    const assignmentError = validateGroupAssignments(assignments);
    if (assignmentError) next.assignments = assignmentError;

    const licErrs: Record<number, string> = {};
    licenses.forEach((l, i) => {
      if (!l.state.trim() && (l.licenseNumber.trim() || l.expirationDate.trim())) {
        licErrs[i] = "Select the license state";
      } else if (
        l.verifiedStatus !== "unverified" &&
        !l.verificationSourceUrl.trim() &&
        l.state.trim()
      ) {
        licErrs[i] = "Recording a verification requires the state-board lookup URL";
      }
    });

    setErrors(next);
    setLicenseErrors(licErrs);
    if (Object.keys(next).length > 0 || Object.keys(licErrs).length > 0) return;

    const onError = (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Couldn't save the provider");
    if (provider) {
      updateMut.mutate(
        {
          patch: toProviderInput(form),
          licenses: licenseDraftsToInputs(licenses),
          groupAssignments: assignments,
        },
        {
          onSuccess: () => {
            toast.success("Provider updated");
            onClose();
          },
          onError,
        },
      );
    } else {
      createMut.mutate(
        {
          provider: toProviderInput(form),
          licenses: licenseDraftsToInputs(licenses),
          facilityIds: [],
          groupAssignments: assignments,
        },
        {
          onSuccess: async (result) => {
            toast.success("Provider added to the roster");
            for (const warning of result.warnings) toast.warning(warning);
            // Record captured enrollment facts under the PRIMARY group's
            // contract — facts only, zero cases (F6.4.4).
            const primaryGroup = assignments.find((a) => a.isPrimary)?.groupId;
            const complete = enrollmentDrafts.filter((d) => d.payerId && d.state);
            if (primaryGroup && complete.length > 0) {
              for (const d of complete) {
                try {
                  await createFact.mutateAsync({
                    providerId: result.provider.id,
                    groupId: primaryGroup,
                    payerId: d.payerId,
                    state: d.state,
                    effectiveDate: d.effectiveDate || null,
                  });
                } catch (e) {
                  toast.error(
                    e instanceof Error ? e.message : "Could not record an enrollment fact",
                  );
                }
              }
              toast.success(
                `${complete.length} enrollment fact${complete.length === 1 ? "" : "s"} recorded — no cases created.`,
              );
            }
            onClose();
          },
          onError,
        },
      );
    }
  };

  return (
    <>
      <div className="space-y-4 py-2">
        {/* Step one: the group leg of the case key (F1.3.2). */}
        <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
          <h3 className="text-[13px] font-semibold text-foreground">Group assignment</h3>
          <GroupAssignmentPicker groups={groups} value={assignments} onChange={setAssignments} />
          <FieldError message={errors.assignments} />
        </div>

        <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
          <h3 className="text-[13px] font-semibold text-foreground">Identity</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="prov-first" className="text-[12px]">
                First name
              </Label>
              <Input
                id="prov-first"
                value={form.firstName}
                onChange={(e) => set({ firstName: e.target.value })}
                className="h-9"
              />
              <FieldError message={errors.firstName} />
            </div>
            <div>
              <Label htmlFor="prov-last" className="text-[12px]">
                Last name
              </Label>
              <Input
                id="prov-last"
                value={form.lastName}
                onChange={(e) => set({ lastName: e.target.value })}
                className="h-9"
              />
              <FieldError message={errors.lastName} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label htmlFor="prov-credentials" className="text-[12px]">
                Credentials
              </Label>
              <Input
                id="prov-credentials"
                value={form.credentials}
                onChange={(e) => set({ credentials: e.target.value })}
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="prov-gender" className="text-[12px]">
                Gender
              </Label>
              <Select value={form.gender} onValueChange={(v) => set({ gender: v })}>
                <SelectTrigger id="prov-gender" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not set</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="nonbinary">Nonbinary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="prov-dob" className="text-[12px]">
                Date of birth
              </Label>
              <Input
                id="prov-dob"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => set({ dateOfBirth: e.target.value })}
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="prov-ssn" className="text-[12px]">
                SSN (last 4 only)
              </Label>
              <Input
                id="prov-ssn"
                value={form.ssnLast4}
                onChange={(e) => set({ ssnLast4: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                inputMode="numeric"
                maxLength={4}
                className="h-9"
              />
              <FieldError message={errors.ssnLast4} />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
          <h3 className="text-[13px] font-semibold text-foreground">Contact</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="prov-email" className="text-[12px]">
                Email
              </Label>
              <Input
                id="prov-email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="prov-phone" className="text-[12px]">
                Phone
              </Label>
              <Input
                id="prov-phone"
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
                className="h-9"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
          <h3 className="text-[13px] font-semibold text-foreground">Professional</h3>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label htmlFor="prov-npi" className="text-[12px]">
                Type 1 NPI
              </Label>
              <Input
                id="prov-npi"
                value={form.npi}
                onChange={(e) => set({ npi: e.target.value })}
                inputMode="numeric"
                className="h-9"
              />
              <FieldError message={errors.npi} />
            </div>
            <div>
              <Label htmlFor="prov-taxonomy" className="text-[12px]">
                Taxonomy code
              </Label>
              <Input
                id="prov-taxonomy"
                value={form.taxonomyCode}
                onChange={(e) => set({ taxonomyCode: e.target.value })}
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="prov-specialty" className="text-[12px]">
                Specialty
              </Label>
              <Input
                id="prov-specialty"
                value={form.specialty}
                onChange={(e) => set({ specialty: e.target.value })}
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="prov-start" className="text-[12px]">
                Start date
              </Label>
              <Input
                id="prov-start"
                type="date"
                value={form.startDate}
                onChange={(e) => set({ startDate: e.target.value })}
                className="h-9"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="prov-degree" className="text-[12px]">
                Degree
              </Label>
              <Input
                id="prov-degree"
                value={form.degree}
                onChange={(e) => set({ degree: e.target.value })}
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="prov-school" className="text-[12px]">
                School
              </Label>
              <Input
                id="prov-school"
                value={form.schoolName}
                onChange={(e) => set({ schoolName: e.target.value })}
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="prov-graduation" className="text-[12px]">
                Graduation date
              </Label>
              <Input
                id="prov-graduation"
                type="date"
                value={form.graduationDate}
                onChange={(e) => set({ graduationDate: e.target.value })}
                className="h-9"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
          <h3 className="text-[13px] font-semibold text-foreground">CAQH</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="prov-caqh" className="text-[12px]">
                CAQH ID
              </Label>
              <Input
                id="prov-caqh"
                value={form.caqhId}
                onChange={(e) => set({ caqhId: e.target.value })}
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="prov-caqh-date" className="text-[12px]">
                Last attestation date
              </Label>
              <Input
                id="prov-caqh-date"
                type="date"
                value={form.caqhLastAttestedDate}
                onChange={(e) => set({ caqhLastAttestedDate: e.target.value })}
                className="h-9"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
          <h3 className="text-[13px] font-semibold text-foreground">State licenses</h3>
          <LicenseListEditor value={licenses} onChange={setLicenses} errors={licenseErrors} />
        </div>

        {/* E6.4 F6.4.4 — migration enrollment capture (create only): facts
            under the primary group's contract, never auto-cases. */}
        {!provider ? (
          <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
            <h3 className="text-[13px] font-semibold text-foreground">
              Current enrollments under the group&apos;s contract
            </h3>
            <p className="text-[12px] text-muted-foreground">{ENROLLMENT_GUARD_TEXT}</p>
            {enrollmentDrafts.map((d, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select
                  value={d.payerId}
                  onValueChange={(v) =>
                    setEnrollmentDrafts((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, payerId: v } : r)),
                    )
                  }
                >
                  <SelectTrigger className="h-8 w-52 text-[13px]" aria-label="Enrollment payer">
                    <SelectValue placeholder="Payer" />
                  </SelectTrigger>
                  <SelectContent>
                    {(payersQ.data ?? []).map((py) => (
                      <SelectItem key={py.id} value={py.id}>
                        {py.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <StateSelect
                  value={d.state}
                  onChange={(v) =>
                    setEnrollmentDrafts((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, state: v } : r)),
                    )
                  }
                  allowNone={false}
                  className="h-8 w-24 text-[13px]"
                />
                <Input
                  type="date"
                  value={d.effectiveDate}
                  onChange={(e) =>
                    setEnrollmentDrafts((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, effectiveDate: e.target.value } : r)),
                    )
                  }
                  className="h-8 w-40 text-[13px]"
                  aria-label="Enrollment effective date"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-[12px]"
                  onClick={() => setEnrollmentDrafts((rows) => rows.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[12px]"
              onClick={() =>
                setEnrollmentDrafts((rows) => [
                  ...rows,
                  { payerId: "", state: "", effectiveDate: "" },
                ])
              }
            >
              + Add enrollment
            </Button>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={pending}
          className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
        >
          {pending ? "Saving…" : provider ? "Save changes" : "Save provider"}
        </Button>
      </DialogFooter>
    </>
  );
}

// Edit needs the full row (getProvider selects *; the list projection is
// PHI-narrowed) plus the provider's licenses and assignments — loaded here,
// then handed to the form as initial state.
function EditLoader({
  providerId,
  groups,
  onClose,
}: {
  providerId: string;
  groups: ProviderGroup[];
  onClose: () => void;
}) {
  const providerQ = useProvider(providerId);
  const licensesQ = useStateLicensesByProvider(providerId);
  const assignmentsQ = useProviderGroupAssignments();

  const ready = providerQ.data && licensesQ.data && assignmentsQ.data;
  const initial = useMemo(() => {
    if (!ready) return null;
    const p = providerQ.data!;
    const form: RosterFormState = {
      firstName: p.firstName,
      lastName: p.lastName,
      credentials: p.credentials ?? "",
      gender: p.gender ?? "__none__",
      dateOfBirth: p.dateOfBirth ?? "",
      ssnLast4: p.ssnLast4 ?? "",
      email: p.email ?? "",
      phone: p.phone ?? "",
      npi: p.npi ?? "",
      taxonomyCode: p.taxonomyCode ?? "",
      specialty: p.specialty ?? "",
      startDate: p.startDate ?? "",
      degree: p.degree ?? "",
      schoolName: p.schoolName ?? "",
      graduationDate: p.graduationDate ?? "",
      caqhId: p.caqhId ?? "",
      caqhLastAttestedDate: p.caqhLastAttestedDate ?? "",
    };
    const licenses: LicenseDraft[] = (licensesQ.data ?? []).map((l) => ({
      id: l.id,
      state: l.state,
      licenseNumber: l.licenseNumber ?? "",
      licenseType: l.licenseType ?? "full",
      issueDate: l.issueDate ?? "",
      expirationDate: l.expirationDate ?? "",
      verifiedStatus: l.verifiedStatus ?? "unverified",
      verificationSourceUrl: l.verificationSourceUrl ?? "",
      storedExpirationDate: l.expirationDate,
      storedVerifiedAt: l.verifiedAt,
    }));
    const assignments: GroupAssignmentInput[] = (assignmentsQ.data ?? [])
      .filter((a) => a.providerId === providerId)
      .map((a) => ({ groupId: a.groupId, isPrimary: a.isPrimary }));
    return { form, licenses, assignments };
  }, [ready, providerQ.data, licensesQ.data, assignmentsQ.data, providerId]);

  if (!initial) {
    return (
      <div className="space-y-3 py-2">
        <Skeleton className="h-16 rounded-md" />
        <Skeleton className="h-16 rounded-md" />
        <Skeleton className="h-16 rounded-md" />
      </div>
    );
  }
  return (
    <FormBody
      provider={providerQ.data!}
      groups={groups}
      initialForm={initial.form}
      initialLicenses={initial.licenses}
      initialAssignments={initial.assignments}
      onClose={onClose}
    />
  );
}

export function ProviderRosterForm({
  provider,
  groups,
  onClose,
}: {
  /** null = create; a LIST row = edit (full row loaded inside). */
  provider: Provider | null;
  groups: ProviderGroup[];
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{provider ? "Edit provider" : "Add provider"}</DialogTitle>
        </DialogHeader>
        {provider ? (
          <EditLoader providerId={provider.id} groups={groups} onClose={onClose} />
        ) : (
          <FormBody
            provider={null}
            groups={groups}
            initialForm={EMPTY_FORM}
            initialLicenses={[{ ...EMPTY_LICENSE_DRAFT }]}
            initialAssignments={[]}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
