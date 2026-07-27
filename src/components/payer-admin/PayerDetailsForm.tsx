// Payer & Cases design bundle, screen 2 (Slice B) — the details form, shared
// by "Details — new" (create step 2) and "Edit payer". ONE component and ONE
// validator (src/lib/payerForm.ts) so the two states can never drift; the
// caller supplies the mode (title/sub/footer/save label + the left footer
// action) and owns the submit, since create routes through create_payer and
// edit through update_payer.
//
// Sections mirror the design: Identity (name · kind · states · aliases) →
// "Enrollment IDs this payer issues" (the two ID-expectation rows that drive
// the screen-5 close dialog) → the optional delegation note.
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PayerStatesField } from "@/components/payer-admin/PayerStatesField";
import { PAYER_KIND_LABELS } from "@/lib/payerDirectory";
import {
  PAYER_KIND_OPTIONS,
  addAlias,
  payerFormErrors,
  removeAlias,
  toggleState,
  type PayerFormDraft,
} from "@/lib/payerForm";
import type { PayerKind } from "@/types";

const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground";
const FIELD_LABEL = "text-[12px] font-semibold uppercase tracking-[.05em] text-[#6B7280]";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-[12.5px] text-[#B91C1C]">
      {message}
    </p>
  );
}

interface IdExpectationRowProps {
  idKey: "group" | "provider";
  title: string;
  scope: string;
  placeholder: string;
  expected: boolean;
  label: string;
  error?: string;
  onToggle: (next: boolean) => void;
  onLabelChange: (next: string) => void;
}

function IdExpectationRow({
  idKey,
  title,
  scope,
  placeholder,
  expected,
  label,
  error,
  onToggle,
  onLabelChange,
}: IdExpectationRowProps) {
  const checkboxId = `payer-${idKey}-id-expected`;
  const labelId = `payer-${idKey}-id-label`;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[#F0EEEA] px-3.5 py-2.5 first:border-t-0">
      <span className="flex min-w-[230px] flex-none items-center gap-2.5">
        <Checkbox
          id={checkboxId}
          checked={expected}
          onCheckedChange={(checked) => onToggle(checked === true)}
        />
        <Label htmlFor={checkboxId} className="cursor-pointer text-[14px] font-semibold">
          {title}
          <span className="ml-1.5 text-[12.5px] font-normal text-muted-foreground">{scope}</span>
        </Label>
      </span>
      {expected ? (
        <span className="flex min-w-[180px] flex-1 flex-col gap-1">
          <Input
            id={labelId}
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder={placeholder}
            aria-label={`${title} — the payer's name for it`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${labelId}-error` : undefined}
            className="h-8"
          />
          <FieldError id={`${labelId}-error`} message={error} />
        </span>
      ) : (
        <span className="min-w-[180px] flex-1 text-[12.5px] text-[#C9C5BE]">Not issued</span>
      )}
    </div>
  );
}

export interface PayerDetailsFormProps {
  mode: "create" | "edit";
  draft: PayerFormDraft;
  onChange: (next: PayerFormDraft) => void;
  /** Shown once the user has tried to submit — fields stay quiet before that. */
  showErrors: boolean;
  onSubmit: () => void;
  submitting: boolean;
  /** Rendered left of the primary action (Back on create, Cancel on edit). */
  secondaryAction: React.ReactNode;
  /** Server-side rejection (duplicate name, RPC guard) — rendered above the footer. */
  submitError?: string | null;
  title: string;
  description: string;
}

export function PayerDetailsForm({
  mode,
  draft,
  onChange,
  showErrors,
  onSubmit,
  submitting,
  secondaryAction,
  submitError,
  title,
  description,
}: PayerDetailsFormProps) {
  const [aliasDraft, setAliasDraft] = useState("");
  const errors = payerFormErrors(draft);
  const visible = showErrors ? errors : {};
  const patch = (next: Partial<PayerFormDraft>) => onChange({ ...draft, ...next });

  const commitAlias = () => {
    const next = addAlias(draft.aliases, aliasDraft, draft.name);
    patch({ aliases: next });
    setAliasDraft("");
  };

  return (
    <form
      className="rounded-[6px] border border-[#E8E5E0] bg-white"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <header className="flex flex-wrap items-start gap-3.5 border-b border-[#E8E5E0] px-5 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] font-semibold tracking-[-.01em] text-foreground">{title}</h1>
          <p className="text-[13px] text-muted-foreground">{description}</p>
        </div>
        {mode === "edit" ? (
          <span className="inline-flex h-[22px] flex-none items-center rounded-[4px] border border-[#E8E5E0] bg-[#F5F4F1] px-2.5 text-[12px] font-medium text-muted-foreground">
            Affects every organization
          </span>
        ) : null}
      </header>

      <div className="flex flex-col gap-5 p-5">
        <section className="space-y-3.5">
          <h2 className={SECTION_LABEL}>Identity</h2>
          <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="payer-name" className={FIELD_LABEL}>
                Payer name
              </Label>
              <Input
                id="payer-name"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                aria-invalid={visible.name ? true : undefined}
                aria-describedby={visible.name ? "payer-name-error" : undefined}
                className="h-9"
              />
              <FieldError id="payer-name-error" message={visible.name} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payer-kind" className={FIELD_LABEL}>
                Kind
              </Label>
              {/* Controlled with "" — Radix renders the placeholder for an
                  empty value, so the field never flips uncontrolled→controlled
                  when the edit form hydrates. */}
              <Select
                value={draft.payerKind}
                onValueChange={(v) => patch({ payerKind: v as PayerKind })}
              >
                <SelectTrigger id="payer-kind" className="h-9" aria-label="Payer kind">
                  <SelectValue placeholder="Select kind…" />
                </SelectTrigger>
                <SelectContent>
                  {PAYER_KIND_OPTIONS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {PAYER_KIND_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="payer-kind-error" message={visible.payerKind} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payer-states" className={FIELD_LABEL}>
              States it operates in
            </Label>
            <PayerStatesField
              id="payer-states"
              value={draft.states}
              onChange={(code) => patch({ states: toggleState(draft.states, code) })}
              invalid={Boolean(visible.states)}
              describedBy={visible.states ? "payer-states-error" : undefined}
            />
            <FieldError id="payer-states-error" message={visible.states} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payer-alias" className={FIELD_LABEL}>
              Aliases
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              {draft.aliases.map((alias) => (
                <span
                  key={alias}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-[#E8E5E0] bg-white pl-2.5 pr-1 text-[13px] text-foreground"
                >
                  {alias}
                  <button
                    type="button"
                    aria-label={`Remove alias ${alias}`}
                    onClick={() => patch({ aliases: removeAlias(draft.aliases, alias) })}
                    className="rounded-[3px] p-0.5 text-muted-foreground hover:bg-[#FBEAEA] hover:text-[#B91C1C]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <Input
                id="payer-alias"
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitAlias();
                  }
                }}
                aria-label="New alias"
                className="h-7 w-44"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 flex-none"
                onClick={commitAlias}
              >
                + Add alias
              </Button>
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              Other names this payer goes by — used to match incoming rosters and correspondence.
            </p>
          </div>
        </section>

        <section className="space-y-3 border-t border-[#F0EEEA] pt-4">
          <div>
            <h2 className={SECTION_LABEL}>Enrollment IDs this payer issues</h2>
            <p className="mt-1 max-w-xl text-[12.5px] text-muted-foreground">
              If this payer issues a group-level or provider-level ID, tick it below and name it the
              way the payer does.
            </p>
          </div>
          <div className="rounded-[6px] border border-[#E8E5E0] bg-white">
            <IdExpectationRow
              idKey="group"
              title="Group-level ID"
              scope="One per group"
              placeholder="e.g. Group PIN"
              expected={draft.groupIdExpected}
              label={draft.groupIdLabel}
              error={visible.groupIdLabel}
              onToggle={(next) => patch({ groupIdExpected: next })}
              onLabelChange={(next) => patch({ groupIdLabel: next })}
            />
            <IdExpectationRow
              idKey="provider"
              title="Provider-level ID"
              scope="One per provider"
              placeholder="e.g. Provider Number"
              expected={draft.providerIdExpected}
              label={draft.providerIdLabel}
              error={visible.providerIdLabel}
              onToggle={(next) => patch({ providerIdExpected: next })}
              onLabelChange={(next) => patch({ providerIdLabel: next })}
            />
          </div>
          {!draft.groupIdExpected && !draft.providerIdExpected ? (
            <p className="rounded-[6px] border border-[#E8E5E0] bg-[#FBFBF9] px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
              This payer issues no enrollment ID. Approving a case will just confirm the effective
              date — no ID fields.
            </p>
          ) : null}
        </section>

        <section className="space-y-1.5 border-t border-[#F0EEEA] pt-4">
          <Label htmlFor="payer-delegation" className={FIELD_LABEL}>
            Delegation note{" "}
            <span className="font-normal normal-case tracking-normal text-muted-foreground">
              — optional
            </span>
          </Label>
          <Textarea
            id="payer-delegation"
            value={draft.delegationNote}
            onChange={(e) => patch({ delegationNote: e.target.value })}
            placeholder="How this payer delegates credentialing, and any quirks worth knowing before working a case."
            className="min-h-[70px]"
          />
        </section>

        {submitError ? (
          <p
            role="alert"
            className="rounded-[4px] border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C]"
          >
            {submitError}
          </p>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center gap-2.5 border-t border-[#E8E5E0] px-5 py-4">
        <span className="min-w-[200px] flex-1 text-[12.5px] text-muted-foreground">
          {mode === "edit"
            ? "Changes apply to every organization using this payer."
            : "You can add templates and portals after the payer exists."}
        </span>
        {secondaryAction}
        <Button
          type="submit"
          disabled={submitting}
          className="flex-none bg-[#1B4D3E] text-white hover:bg-[#163F33]"
        >
          {submitting
            ? mode === "edit"
              ? "Saving…"
              : "Creating…"
            : mode === "edit"
              ? "Save changes"
              : "Create payer"}
        </Button>
      </footer>
    </form>
  );
}
