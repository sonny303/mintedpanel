import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { StateSelect } from "@/components/StateSelect";
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
        <div className={sectionLabel}>Authorized contact</div>
        <div>
          <Label className="text-[12px]">Name</Label>
          <Input
            value={form.ownerName}
            onChange={(e) => form.setOwnerName(e.target.value)}
            aria-invalid={form.errors.ownerName ? true : undefined}
            className="h-9"
          />
          {form.errors.ownerName ? <div className={fieldError}>{form.errors.ownerName}</div> : null}
        </div>
        <div>
          <Label className="text-[12px]">Email</Label>
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
        <div className={sectionLabel}>Organization contact</div>
        <div>
          <Label className="text-[12px]" htmlFor="customer-name">
            Name
          </Label>
          <Input
            id="customer-name"
            value={form.customer.name}
            onChange={(e) => form.patchCustomer({ name: e.target.value })}
            aria-invalid={form.customerErrors.name ? true : undefined}
            className="h-9"
          />
          {form.customerErrors.name ? (
            <div className={fieldError}>{form.customerErrors.name}</div>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-[12px]" htmlFor="customer-email">
              Email
            </Label>
            <Input
              id="customer-email"
              type="email"
              value={form.customer.email}
              onChange={(e) => form.patchCustomer({ email: e.target.value })}
              aria-invalid={form.customerErrors.email ? true : undefined}
              className="h-9"
            />
            {form.customerErrors.email ? (
              <div className={fieldError}>{form.customerErrors.email}</div>
            ) : null}
          </div>
          <div>
            <Label className="text-[12px]" htmlFor="customer-phone">
              Phone
            </Label>
            <Input
              id="customer-phone"
              value={form.customer.phoneOffice}
              onChange={(e) => form.patchCustomer({ phoneOffice: e.target.value })}
              aria-invalid={form.customerErrors.phoneOffice ? true : undefined}
              className="h-9"
            />
            {form.customerErrors.phoneOffice ? (
              <div className={fieldError}>{form.customerErrors.phoneOffice}</div>
            ) : null}
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className={sectionLabel}>Organization address</div>
        <div>
          <Label className="text-[12px]" htmlFor="customer-line1">
            Street address
          </Label>
          <Input
            id="customer-line1"
            value={form.customer.addressLine1}
            onChange={(e) => form.patchCustomer({ addressLine1: e.target.value })}
            aria-invalid={form.customerErrors.addressLine1 ? true : undefined}
            className="h-9"
          />
          {form.customerErrors.addressLine1 ? (
            <div className={fieldError}>{form.customerErrors.addressLine1}</div>
          ) : null}
        </div>
        <div>
          <Label className="text-[12px]" htmlFor="customer-line2">
            Suite / unit <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="customer-line2"
            value={form.customer.addressLine2 ?? ""}
            onChange={(e) => form.patchCustomer({ addressLine2: e.target.value })}
            className="h-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-2">
            <Label className="text-[12px]" htmlFor="customer-city">
              City
            </Label>
            <Input
              id="customer-city"
              value={form.customer.city}
              onChange={(e) => form.patchCustomer({ city: e.target.value })}
              aria-invalid={form.customerErrors.city ? true : undefined}
              className="h-9"
            />
            {form.customerErrors.city ? (
              <div className={fieldError}>{form.customerErrors.city}</div>
            ) : null}
          </div>
          <div>
            <Label className="text-[12px]" htmlFor="customer-state">
              State
            </Label>
            <StateSelect
              id="customer-state"
              value={form.customer.state}
              onChange={(state) => form.patchCustomer({ state })}
              invalid={form.customerErrors.state ? true : undefined}
            />
            {form.customerErrors.state ? (
              <div className={fieldError}>{form.customerErrors.state}</div>
            ) : null}
          </div>
          <div>
            <Label className="text-[12px]" htmlFor="customer-zip">
              Postal code
            </Label>
            <Input
              id="customer-zip"
              value={form.customer.postalCode}
              onChange={(e) => form.patchCustomer({ postalCode: e.target.value })}
              aria-invalid={form.customerErrors.postalCode ? true : undefined}
              className="h-9"
            />
            {form.customerErrors.postalCode ? (
              <div className={fieldError}>{form.customerErrors.postalCode}</div>
            ) : null}
          </div>
        </div>
      </div>

      {form.errors.form ? (
        <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
          {form.errors.form}
        </div>
      ) : null}
    </div>
  );
}
