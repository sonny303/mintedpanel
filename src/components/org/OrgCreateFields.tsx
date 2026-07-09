// Presentational create-org fields (E0.1 + E0.2 TE-3): organization name +
// required owner (name/email) + required customer-escalation contact + sales rep
// (pre-filled with Zeb). Inline field errors and a non-blocking "did you mean"
// nudge for common owner-email typos. Composed only from existing primitives;
// state + submit live in the parent via useOrgCreateForm.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ContactFields } from "@/components/org/ContactFields";
import type { OrgCreateForm } from "@/hooks/useOrgCreateForm";

const fieldError = "mt-1 text-[12px] text-[#B91C1C]";
const sectionLabel = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

export function OrgCreateFields({ form }: { form: OrgCreateForm }) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-[12px]">Organization name</Label>
        <Input
          autoFocus
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
          aria-invalid={form.errors.name ? true : undefined}
          className="h-9"
        />
        {form.errors.name ? <div className={fieldError}>{form.errors.name}</div> : null}
      </div>

      <div className="space-y-3">
        <div className={sectionLabel}>Owner</div>
        <div>
          <Label className="text-[12px]">Owner name</Label>
          <Input
            value={form.ownerName}
            onChange={(e) => form.setOwnerName(e.target.value)}
            aria-invalid={form.errors.ownerName ? true : undefined}
            className="h-9"
          />
          {form.errors.ownerName ? <div className={fieldError}>{form.errors.ownerName}</div> : null}
        </div>
        <div>
          <Label className="text-[12px]">Owner email</Label>
          <Input
            type="email"
            value={form.ownerEmail}
            onChange={(e) => form.setOwnerEmail(e.target.value)}
            aria-invalid={form.errors.ownerEmail ? true : undefined}
            className="h-9"
          />
          {form.errors.ownerEmail ? (
            <div className={fieldError}>{form.errors.ownerEmail}</div>
          ) : null}
          {form.emailWarning ? (
            <div className="mt-1 text-[12px] text-[#92400E]">
              Did you mean{" "}
              <button
                type="button"
                onClick={form.applyEmailSuggestion}
                className="font-medium underline underline-offset-2"
              >
                {form.emailWarning}
              </button>
              ?
            </div>
          ) : null}
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className={sectionLabel}>Customer escalation contact</div>
        <ContactFields
          value={form.customer}
          onChange={form.patchCustomer}
          errors={form.customerErrors}
          idPrefix="customer"
        />
      </div>

      <Separator />

      <div className="space-y-3">
        <div className={sectionLabel}>Minted Panel sales rep</div>
        <ContactFields
          value={form.salesRep}
          onChange={form.patchSalesRep}
          errors={form.salesErrors}
          idPrefix="sales"
        />
      </div>

      {form.errors.form ? (
        <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
          {form.errors.form}
        </div>
      ) : null}
    </div>
  );
}
