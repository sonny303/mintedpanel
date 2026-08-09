// Payer & Cases design bundle, screen 2 (Slice B) — "+ Set up payer", the ONE
// way a payer enters the system now that the seeded catalog browse is retired
// (Slice A ships the entry points; this route is the flow). Two steps on one
// route: step 1 asks the name and surfaces near matches BEFORE any other field
// (the duplicate guardrail), step 2 collects the details and calls
// create_payer.
//
// 3M Slice 6 / D6.2 — creating still ADDS by default (the ops intent this
// route was built for), but "Also add to my network" can be unticked to
// author the catalog identity alone: the platform loop (payer → SOP → shared
// portal → train → map) does not need an org to have adopted the payer, and
// adoption stays the Payer Detail "Add to my network" verb. The checkbox is
// the smallest shape that carries both intents through one form; the toast
// must never claim network membership the RPC was not asked to create.
//
// Un-nested with the `payers_` idiom (the admin.payers_.$id.scorecard
// precedent) so the /admin/payers redirect shell never hijacks it.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  // D6.2: default ON — this route is reached from Payer Setup, where the
  // intent is almost always "set this payer up for my network".
  const [assignToOrg, setAssignToOrg] = useState(true);
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
    createMut.mutate(
      { ...toPayerWriteInput(draft), assignToOrg },
      {
        onSuccess: (payer) => {
          // Two intents, two honest confirmations: an unassigned create made a
          // catalog record and nothing else, and saying otherwise would send
          // the user looking for it in a list it is not in.
          toast.success(
            assignToOrg
              ? `${payer.name} added to your network`
              : `${payer.name} created in the payer catalog`,
          );
          void navigate({ to: "/admin/payer-admin/setup/$payerId", params: { payerId: payer.id } });
        },
        onError: (e) =>
          setSubmitError(e instanceof Error ? e.message : "Couldn't create the payer."),
      },
    );
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
          networkSection={
            <div className="flex flex-wrap items-start gap-2.5">
              <Checkbox
                id="payer-assign-to-org"
                checked={assignToOrg}
                onCheckedChange={(checked) => setAssignToOrg(checked === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="payer-assign-to-org"
                className="min-w-[200px] flex-1 cursor-pointer text-[14px] font-semibold"
              >
                Also add to my network
                <span className="mt-0.5 block text-[12.5px] font-normal text-muted-foreground">
                  {assignToOrg
                    ? "The payer appears in Payer Setup, and groups can attach it for credentialing scope."
                    : "Creates the catalog record only — set up its template and form now, and add it to your network when you're ready to work it."}
                </span>
              </Label>
            </div>
          }
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
