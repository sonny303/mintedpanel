// Payer & Cases design bundle, screen 2 (Slice B) — "+ Set up payer", the ONE
// way a payer enters the system now that the seeded catalog browse is retired
// (Slice A ships the entry points; this route is the flow). Two steps on one
// route: step 1 asks the name and surfaces near matches BEFORE any other field
// (the duplicate guardrail), step 2 collects the details and calls
// create_payer.
//
// OPA-RETIRE (R1 B): create_payer writes the GLOBAL catalog row only —
// it does not upsert org_payer_assignments. Attach to a group to put the
// payer in network. The Slice 6 "Also add to my network" checkbox stays gone.
//
// Un-nested with the `payers_` idiom (the admin.payers_.$id.scorecard
// precedent) so the /admin/payers redirect shell never hijacks it.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PayerDetailsForm } from "@/components/payer-admin/PayerDetailsForm";
import { PayerNameStep } from "@/components/payer-admin/PayerNameStep";
import { useCreatePayer } from "@/hooks/useAdmin";
import { useGlobalPayers } from "@/hooks/usePayerCatalog";
import {
  EMPTY_PAYER_FORM,
  hasPayerFormErrors,
  payerFormErrors,
  toPayerWriteInput,
  type PayerFormDraft,
} from "@/lib/payerForm";
import { findPayerNearMatches } from "@/lib/payerNearMatch";

export const Route = createFileRoute("/admin/payers_/new")({
  component: SetUpPayerPage,
});

function SetUpPayerPage() {
  const navigate = useNavigate();
  const catalogQ = useGlobalPayers();
  const createMut = useCreatePayer();

  const [step, setStep] = useState<"name" | "details">("name");
  const [draft, setDraft] = useState<PayerFormDraft>(EMPTY_PAYER_FORM);
  const [showErrors, setShowErrors] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // The near-match pool is every global row (create_payer's duplicate guard
  // runs against the same universe), so a collision surfaces here rather than
  // as a server rejection after the whole form is filled in.
  const matches = useMemo(
    () => findPayerNearMatches(draft.name, catalogQ.data ?? []),
    [draft.name, catalogQ.data],
  );

  const handleContinue = () => {
    if (draft.name.trim() === "") {
      setNameError("A payer name is required.");
      return;
    }
    setNameError(null);
    setStep("details");
  };

  // The near-match check IS the duplicate guardrail — a failed catalog read
  // must never degrade to "no matches" and wave the user past it. Retriable
  // error panel instead (the edit route's posture).
  if (catalogQ.isError) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link
          to="/admin/payer-admin/setup"
          className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
        >
          ← Back to Payer Setup
        </Link>
        <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-[13px] text-[#B91C1C]">
          Couldn&apos;t load the payer catalog, so the duplicate check can&apos;t run.{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => catalogQ.refetch()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const handleCreate = () => {
    setShowErrors(true);
    setSubmitError(null);
    if (hasPayerFormErrors(payerFormErrors(draft))) return;
    createMut.mutate(toPayerWriteInput(draft), {
      onSuccess: (payer) => {
        toast.success(`${payer.name} created in the payer catalog`);
        void navigate({ to: "/admin/payer-admin/setup/$payerId", params: { payerId: payer.id } });
      },
      onError: (e) => setSubmitError(e instanceof Error ? e.message : "Couldn't create the payer."),
    });
  };

  return (
    <div className="mx-auto max-w-3xl">
      {step === "name" ? (
        <PayerNameStep
          name={draft.name}
          onNameChange={(name) => {
            setDraft((prev) => ({ ...prev, name }));
            if (nameError) setNameError(null);
          }}
          matches={matches}
          loadingMatches={catalogQ.isLoading}
          error={nameError}
          onContinue={handleContinue}
        />
      ) : (
        <PayerDetailsForm
          mode="create"
          title={`Add ${draft.name.trim() || "a payer"}`}
          description="No existing payer matched, so this creates a new catalog record."
          draft={draft}
          onChange={setDraft}
          showErrors={showErrors}
          onSubmit={handleCreate}
          submitting={createMut.isPending}
          submitError={submitError}
          secondaryAction={
            <Button
              type="button"
              variant="outline"
              className="flex-none"
              onClick={() => setStep("name")}
            >
              Back
            </Button>
          }
        />
      )}
    </div>
  );
}
