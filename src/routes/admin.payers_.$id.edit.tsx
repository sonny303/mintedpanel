// Payer & Cases design bundle, screen 2 "Edit payer" (Slice B) — the same
// details form, hydrated from the record and saved through update_payer.
// These are CATALOG facts: an edit lands for every organization using the
// payer, which the header badge and footer note say out loud.
//
// The row is resolved from the GLOBAL catalog read (list_global_payers), the
// same source the payer detail uses — getPayer's RLS or-filter can't see an
// unassigned global row, and an admin may legitimately edit a payer their org
// has not adopted. update_payer edits ACTIVE global rows only, so a
// retired/merged row renders read-only guidance instead of a form that would
// be rejected server-side.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PayerDetailsForm } from "@/components/payer-admin/PayerDetailsForm";
import { useUpdatePayer } from "@/hooks/useAdmin";
import { useGlobalPayers } from "@/hooks/usePayerCatalog";
import {
  hasPayerFormErrors,
  payerDraftFromPayer,
  payerFormErrors,
  toPayerWriteInput,
  type PayerFormDraft,
} from "@/lib/payerForm";
import type { Payer } from "@/types";

export const Route = createFileRoute("/admin/payers_/$id/edit")({
  component: EditPayerPage,
});

function BackLink({ payerId }: { payerId: string }) {
  return (
    <Link
      to="/admin/payer-admin/catalog/$payerId"
      params={{ payerId }}
      className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
    >
      ← Back to the payer
    </Link>
  );
}

function EditPayerPage() {
  const { id } = Route.useParams();
  const catalogQ = useGlobalPayers();

  const payer = useMemo(
    () => (catalogQ.data ?? []).find((p) => p.id === id) ?? null,
    [catalogQ.data, id],
  );

  if (catalogQ.isError) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink payerId={id} />
        <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-[13px] text-[#B91C1C]">
          Couldn&apos;t load the payer.{" "}
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

  if (catalogQ.data === undefined) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink payerId={id} />
        <Skeleton className="h-64 w-full rounded-[6px]" />
      </div>
    );
  }

  if (!payer) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink payerId={id} />
        <div className="rounded-md border border-[#E8E5E0] bg-white p-6 text-center">
          <h1 className="text-[15px] font-semibold text-foreground">Payer not found</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            This payer isn&apos;t in the catalog (or the link is stale).
          </p>
        </div>
      </div>
    );
  }

  const status = payer.status ?? "active";
  if (status !== "active") {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink payerId={payer.id} />
        <div className="rounded-[6px] border border-[#E8E5E0] bg-white p-6">
          <h1 className="text-[17px] font-semibold text-foreground">{payer.name}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {status === "merged"
              ? "This payer was merged into another record, so its catalog facts are frozen."
              : "This payer is retired, so its catalog facts are frozen."}
          </p>
          <Link
            to="/admin/payer-admin/catalog/$payerId"
            params={{ payerId: payer.id }}
            className={`mt-4 inline-flex ${buttonVariants({ variant: "outline" })}`}
          >
            View the payer
          </Link>
        </div>
      </div>
    );
  }

  // Keyed by id so the form REMOUNTS (and re-hydrates) only when the payer
  // changes; a background catalog refetch can never stomp an edit in progress.
  return <EditPayerForm key={payer.id} payer={payer} />;
}

/**
 * The draft is seeded synchronously from the record at mount — never patched
 * in later by an effect, so every controlled field (the Kind select above all)
 * renders its hydrated value from the very first paint.
 */
function EditPayerForm({ payer }: { payer: Payer }) {
  const navigate = useNavigate();
  const updateMut = useUpdatePayer();
  const [draft, setDraft] = useState<PayerFormDraft>(() => payerDraftFromPayer(payer));
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSave = () => {
    setShowErrors(true);
    setSubmitError(null);
    if (hasPayerFormErrors(payerFormErrors(draft))) return;
    updateMut.mutate(
      { id: payer.id, input: toPayerWriteInput(draft) },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} updated`);
          void navigate({
            to: "/admin/payer-admin/catalog/$payerId",
            params: { payerId: saved.id },
          });
        },
        onError: (e) => setSubmitError(e instanceof Error ? e.message : "Couldn't save the payer."),
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink payerId={payer.id} />
      <PayerDetailsForm
        mode="edit"
        title="Edit payer"
        description="These are catalog facts — every organization sees them."
        draft={draft}
        onChange={setDraft}
        showErrors={showErrors}
        onSubmit={handleSave}
        submitting={updateMut.isPending}
        submitError={submitError}
        secondaryAction={
          <Button asChild variant="outline" className="flex-none">
            <Link to="/admin/payer-admin/catalog/$payerId" params={{ payerId: payer.id }}>
              Cancel
            </Link>
          </Button>
        }
      />
    </div>
  );
}
