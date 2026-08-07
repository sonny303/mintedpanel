import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StateSelect } from "@/components/StateSelect";
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
      {/* D6: the name is captured SPLIT because payer forms ask for it split.
          The composed display value is derived at the service boundary. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-[12px]" htmlFor={`${idPrefix}-first-name`}>
            First name
          </Label>
          <Input
            id={`${idPrefix}-first-name`}
            value={value.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            aria-invalid={errors.firstName ? true : undefined}
            aria-describedby={errors.firstName ? `${idPrefix}-first-name-error` : undefined}
            className="h-9"
          />
          {errors.firstName ? (
            <div id={`${idPrefix}-first-name-error`} aria-live="polite" className={errClass}>
              {errors.firstName}
            </div>
          ) : null}
        </div>
        <div>
          <Label className="text-[12px]" htmlFor={`${idPrefix}-last-name`}>
            Last name
          </Label>
          <Input
            id={`${idPrefix}-last-name`}
            value={value.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            aria-invalid={errors.lastName ? true : undefined}
            aria-describedby={errors.lastName ? `${idPrefix}-last-name-error` : undefined}
            className="h-9"
          />
          {errors.lastName ? (
            <div id={`${idPrefix}-last-name-error`} aria-live="polite" className={errClass}>
              {errors.lastName}
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <Label className="text-[12px]" htmlFor={`${idPrefix}-title`}>
          Title <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`${idPrefix}-title`}
          value={value.title ?? ""}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Managing Partner"
          className="h-9"
        />
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
            aria-describedby={errors.email ? `${idPrefix}-email-error` : undefined}
            className="h-9"
          />
          {errors.email ? (
            <div id={`${idPrefix}-email-error`} aria-live="polite" className={errClass}>
              {errors.email}
            </div>
          ) : null}
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
            aria-describedby={errors.phoneOffice ? `${idPrefix}-phone-error` : undefined}
            className="h-9"
          />
          {errors.phoneOffice ? (
            <div id={`${idPrefix}-phone-error`} aria-live="polite" className={errClass}>
              {errors.phoneOffice}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-[12px]" htmlFor={`${idPrefix}-ext`}>
            Extension <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={`${idPrefix}-ext`}
            value={value.phoneExtension ?? ""}
            onChange={(e) => onChange({ phoneExtension: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-[12px]" htmlFor={`${idPrefix}-fax`}>
            Fax <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={`${idPrefix}-fax`}
            value={value.fax ?? ""}
            onChange={(e) => onChange({ fax: e.target.value })}
            className="h-9"
          />
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
          aria-describedby={errors.addressLine1 ? `${idPrefix}-line1-error` : undefined}
          className="h-9"
        />
        {errors.addressLine1 ? (
          <div id={`${idPrefix}-line1-error`} aria-live="polite" className={errClass}>
            {errors.addressLine1}
          </div>
        ) : null}
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
            aria-describedby={errors.city ? `${idPrefix}-city-error` : undefined}
            className="h-9"
          />
          {errors.city ? (
            <div id={`${idPrefix}-city-error`} aria-live="polite" className={errClass}>
              {errors.city}
            </div>
          ) : null}
        </div>
        <div>
          <Label className="text-[12px]" htmlFor={`${idPrefix}-state`}>
            State
          </Label>
          <StateSelect
            id={`${idPrefix}-state`}
            value={value.state}
            onChange={(state) => onChange({ state })}
            invalid={errors.state ? true : undefined}
            describedBy={errors.state ? `${idPrefix}-state-error` : undefined}
          />
          {errors.state ? (
            <div id={`${idPrefix}-state-error`} aria-live="polite" className={errClass}>
              {errors.state}
            </div>
          ) : null}
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
            aria-describedby={errors.postalCode ? `${idPrefix}-zip-error` : undefined}
            className="h-9"
          />
          {errors.postalCode ? (
            <div id={`${idPrefix}-zip-error`} aria-live="polite" className={errClass}>
              {errors.postalCode}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
