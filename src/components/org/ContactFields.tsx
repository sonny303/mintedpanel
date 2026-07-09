// Reusable CRM-contact field group (E0.2): name, email, phone, and a SPLIT
// address laid out vertically for clarity (UX note) — never one string. Used for
// the customer contact and the sales rep in the create-org form and the edit
// dialog. Composed only from existing primitives (label + input).
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ContactInput } from "@/types";
import type { ContactFieldErrors } from "@/lib/contactValidation";

interface ContactFieldsProps {
  value: ContactInput;
  onChange: (patch: Partial<ContactInput>) => void;
  errors?: ContactFieldErrors;
  idPrefix: string;
}

const errClass = "mt-1 text-[12px] text-[#B91C1C]";

export function ContactFields({ value, onChange, errors = {}, idPrefix }: ContactFieldsProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-[12px]" htmlFor={`${idPrefix}-name`}>
          Name
        </Label>
        <Input
          id={`${idPrefix}-name`}
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-invalid={errors.name ? true : undefined}
          className="h-9"
        />
        {errors.name ? <div className={errClass}>{errors.name}</div> : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-[12px]" htmlFor={`${idPrefix}-email`}>
            Email
          </Label>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            value={value.email}
            onChange={(e) => onChange({ email: e.target.value })}
            aria-invalid={errors.email ? true : undefined}
            className="h-9"
          />
          {errors.email ? <div className={errClass}>{errors.email}</div> : null}
        </div>
        <div>
          <Label className="text-[12px]" htmlFor={`${idPrefix}-phone`}>
            Phone
          </Label>
          <Input
            id={`${idPrefix}-phone`}
            value={value.phoneOffice}
            onChange={(e) => onChange({ phoneOffice: e.target.value })}
            aria-invalid={errors.phoneOffice ? true : undefined}
            className="h-9"
          />
          {errors.phoneOffice ? <div className={errClass}>{errors.phoneOffice}</div> : null}
        </div>
      </div>

      <div>
        <Label className="text-[12px]" htmlFor={`${idPrefix}-line1`}>
          Street address
        </Label>
        <Input
          id={`${idPrefix}-line1`}
          value={value.addressLine1}
          onChange={(e) => onChange({ addressLine1: e.target.value })}
          aria-invalid={errors.addressLine1 ? true : undefined}
          className="h-9"
        />
        {errors.addressLine1 ? <div className={errClass}>{errors.addressLine1}</div> : null}
      </div>

      <div>
        <Label className="text-[12px]" htmlFor={`${idPrefix}-line2`}>
          Suite / unit <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`${idPrefix}-line2`}
          value={value.addressLine2 ?? ""}
          onChange={(e) => onChange({ addressLine2: e.target.value })}
          className="h-9"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-2">
          <Label className="text-[12px]" htmlFor={`${idPrefix}-city`}>
            City
          </Label>
          <Input
            id={`${idPrefix}-city`}
            value={value.city}
            onChange={(e) => onChange({ city: e.target.value })}
            aria-invalid={errors.city ? true : undefined}
            className="h-9"
          />
          {errors.city ? <div className={errClass}>{errors.city}</div> : null}
        </div>
        <div>
          <Label className="text-[12px]" htmlFor={`${idPrefix}-state`}>
            State
          </Label>
          <Input
            id={`${idPrefix}-state`}
            value={value.state}
            onChange={(e) => onChange({ state: e.target.value })}
            aria-invalid={errors.state ? true : undefined}
            className="h-9"
          />
          {errors.state ? <div className={errClass}>{errors.state}</div> : null}
        </div>
        <div>
          <Label className="text-[12px]" htmlFor={`${idPrefix}-zip`}>
            Postal code
          </Label>
          <Input
            id={`${idPrefix}-zip`}
            value={value.postalCode}
            onChange={(e) => onChange({ postalCode: e.target.value })}
            aria-invalid={errors.postalCode ? true : undefined}
            className="h-9"
          />
          {errors.postalCode ? <div className={errClass}>{errors.postalCode}</div> : null}
        </div>
      </div>
    </div>
  );
}
