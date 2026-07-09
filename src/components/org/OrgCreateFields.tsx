// Presentational create-org fields (E0.1 TE-3): organization name + required
// owner name + owner email, with inline field errors and a non-blocking
// "did you mean" nudge for common email-domain typos. Composed only from
// existing primitives (label + input). State + submit live in the parent via
// useOrgCreateForm.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrgCreateForm } from "@/hooks/useOrgCreateForm";

const fieldError = "mt-1 text-[12px] text-[#B91C1C]";

export function OrgCreateFields({ form }: { form: OrgCreateForm }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-[12px]">Organization name</Label>
        <Input
          autoFocus
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") form.submit();
          }}
          aria-invalid={form.errors.name ? true : undefined}
          className="h-9"
        />
        {form.errors.name ? <div className={fieldError}>{form.errors.name}</div> : null}
      </div>

      <div>
        <Label className="text-[12px]">Owner name</Label>
        <Input
          value={form.ownerName}
          onChange={(e) => form.setOwnerName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") form.submit();
          }}
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
          onKeyDown={(e) => {
            if (e.key === "Enter") form.submit();
          }}
          aria-invalid={form.errors.ownerEmail ? true : undefined}
          className="h-9"
        />
        {form.errors.ownerEmail ? <div className={fieldError}>{form.errors.ownerEmail}</div> : null}
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

      {form.errors.form ? (
        <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
          {form.errors.form}
        </div>
      ) : null}
    </div>
  );
}
