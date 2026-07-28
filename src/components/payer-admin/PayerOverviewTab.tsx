// Payer & Cases design bundle, screen 3 Overview (Slice C) — identity &
// enrollment ID, aliases, delegation, state coverage, contacts.
//
// §2.11 EDITABLE IN PLACE: "Edit payer" swaps the read card for Slice B's
// PayerDetailsForm (mode="edit") right here — ONE form, ONE validator, ONE
// write path (update_payer). Hydration goes through payerDraftFromPayer, which
// reads the shared resolver chain, so a NULL-column payer shows (and saves)
// provider-EXPECTED rather than silently flipping the catalog-wide
// Approved-close requirement off — the Slice B blocker, never re-litigated
// with a local default.
//
// Aliases keep the designed inline add/remove in READ mode; they ride the SAME
// update_payer path over a freshly hydrated draft, so an alias edit can never
// carry a stale ID expectation.
import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PayerContactsCard } from "@/components/payer-admin/PayerContactsCard";
import { PayerDetailsForm } from "@/components/payer-admin/PayerDetailsForm";
import { useUpdatePayer } from "@/hooks/useAdmin";
import {
  addAlias,
  hasPayerFormErrors,
  payerDraftFromPayer,
  payerFormErrors,
  removeAlias,
  toPayerWriteInput,
  type PayerFormDraft,
} from "@/lib/payerForm";
import { PAYER_KIND_LABELS } from "@/lib/payerDirectory";
import {
  resolveGroupIdentifierConfig,
  resolveIdentifierConfig,
} from "@/lib/payerResolutionIdentifier";
import { useIsAdmin } from "@/lib/permissions";
import type { Payer } from "@/types";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-foreground">{value}</dd>
    </div>
  );
}

function IdentityFacts({ payer }: { payer: Payer }) {
  // The SAME resolvers the close dialog and set_case_status consume — the
  // provider side defaults EXPECTED on NULL columns, the group side does not.
  const provider = resolveIdentifierConfig(payer);
  const group = resolveGroupIdentifierConfig(payer);
  const status = payer.status ?? "active";
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      <Fact label="Payer kind" value={PAYER_KIND_LABELS[payer.payerKind ?? "commercial"]} />
      <Fact
        label="Status"
        value={status === "active" ? "Active" : status === "merged" ? "Merged" : "Retired"}
      />
      <Fact label="Catalog key" value={payer.payerSlug || "—"} />
      <Fact
        label="Provider-level ID"
        value={provider.expected ? provider.individualLabel : "Not issued"}
      />
      <Fact label="Group-level ID" value={group.expected ? group.groupLabel : "Not issued"} />
    </dl>
  );
}

export function PayerOverviewTab({
  payer,
  onViewScorecard,
  startEditing = false,
}: {
  payer: Payer;
  onViewScorecard: () => void;
  /** `?edit=1` (the retired standalone edit page redirects with it) opens the
   *  identity editor straight away instead of the read card. */
  startEditing?: boolean;
}) {
  const isAdmin = useIsAdmin();
  const updateMut = useUpdatePayer();
  // `update_payer` edits ACTIVE global rows only, so a merged/retired payer is
  // never editable here (the retired standalone edit page carried the same
  // guard — it must not be lost with the page).
  const canEdit = isAdmin && (payer.status ?? "active") === "active";
  // A non-null draft IS the editing state — one source of truth, so the form
  // can never render against a stale or absent draft. Seeded SYNCHRONOUSLY (at
  // mount for `?edit=1`, on click otherwise) — never patched in by an effect,
  // so every controlled field renders hydrated from the first paint.
  const [draft, setDraft] = useState<PayerFormDraft | null>(() =>
    startEditing && canEdit ? payerDraftFromPayer(payer) : null,
  );
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [aliasFormOpen, setAliasFormOpen] = useState(false);

  const beginEditing = () => {
    setDraft(payerDraftFromPayer(payer));
    setShowErrors(false);
    setSubmitError(null);
  };

  const handleSave = () => {
    if (!draft) return;
    setShowErrors(true);
    setSubmitError(null);
    if (hasPayerFormErrors(payerFormErrors(draft))) return;
    updateMut.mutate(
      { id: payer.id, input: toPayerWriteInput(draft) },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} updated`);
          setDraft(null);
        },
        onError: (e) => setSubmitError(e instanceof Error ? e.message : "Couldn't save the payer."),
      },
    );
  };

  // Alias edits ride a freshly hydrated draft so nothing else can drift.
  const saveAliases = (aliases: string[]) => {
    const next = { ...payerDraftFromPayer(payer), aliases };
    // Same gate handleSave applies. The hydrated draft carries the payer's own
    // fields, so a row that would fail validation must be repaired through Edit
    // payer rather than rejected by update_payer after a pointless round trip.
    if (hasPayerFormErrors(payerFormErrors(next))) {
      toast.error("Fix this payer's details before editing aliases.");
      return;
    }
    updateMut.mutate(
      { id: payer.id, input: toPayerWriteInput(next) },
      {
        onSuccess: () => setAliasDraft(""),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save the alias"),
      },
    );
  };

  if (draft && canEdit) {
    return (
      <div className="space-y-4">
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
            <Button
              type="button"
              variant="outline"
              className="flex-none"
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          }
        />
      </div>
    );
  }

  const aliases = payer.aliases ?? [];
  const states = payer.states ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-[6px] border border-[#E8E5E0] bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#E8E5E0] px-5 py-4">
          <h2 className="flex-1 text-[16px] font-semibold text-foreground">
            Identity &amp; enrollment ID
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-[12px]"
            onClick={onViewScorecard}
          >
            View scorecard
          </Button>
          {canEdit ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-[12px]"
              onClick={beginEditing}
            >
              Edit payer
            </Button>
          ) : null}
        </div>
        <div className="space-y-5 p-5">
          <div className="rounded-[6px] border border-[#E8E5E0] bg-[#FBFBF9] px-4 py-3">
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-foreground">Catalog facts</span>
              <span className="inline-flex h-5 items-center rounded-[4px] bg-[#FBF0E1] px-2 text-[11.5px] font-medium text-[#B45309]">
                All organizations
              </span>
            </div>
            <IdentityFacts payer={payer} />
          </div>

          {payer.delegationNote?.trim() ? (
            <div className="rounded-[4px] border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">
              Delegated: {payer.delegationNote}
            </div>
          ) : null}

          <div>
            <div className="mb-1.5">
              <span className="text-[13px] font-semibold text-foreground">Aliases</span>
              <p className="text-[12px] text-muted-foreground">
                Used to match incoming rosters and payer correspondence to this record.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {aliases.map((alias) => (
                <span
                  key={alias}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-[#E8E5E0] bg-white pl-2.5 pr-1 text-[13px] text-foreground"
                >
                  {alias}
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={`Remove alias ${alias}`}
                      disabled={updateMut.isPending}
                      onClick={() => saveAliases(removeAlias(aliases, alias))}
                      className="rounded-[3px] p-0.5 text-muted-foreground hover:bg-[#FBEAEA] hover:text-[#B91C1C]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </span>
              ))}
              {aliases.length === 0 && !aliasFormOpen ? (
                <span className="text-[13px] text-muted-foreground">No aliases yet.</span>
              ) : null}
              {canEdit && aliasFormOpen ? (
                <span className="inline-flex items-center gap-1.5">
                  <Input
                    value={aliasDraft}
                    onChange={(e) => setAliasDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveAliases(addAlias(aliases, aliasDraft, payer.name));
                      }
                    }}
                    aria-label="New alias"
                    placeholder="Other name this payer goes by"
                    className="h-7 w-56"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 bg-[#1B4D3E] px-2.5 text-[12px] text-white hover:bg-[#163F33]"
                    disabled={updateMut.isPending}
                    onClick={() => saveAliases(addAlias(aliases, aliasDraft, payer.name))}
                  >
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-[12px]"
                    onClick={() => {
                      setAliasFormOpen(false);
                      setAliasDraft("");
                    }}
                  >
                    Cancel
                  </Button>
                </span>
              ) : null}
              {canEdit && !aliasFormOpen ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-[12px]"
                  onClick={() => setAliasFormOpen(true)}
                >
                  + Add alias
                </Button>
              ) : null}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-foreground">
              State coverage ({states.length})
            </div>
            {states.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No state coverage recorded.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {states.map((s) => (
                  <span
                    key={s}
                    className="rounded-[4px] bg-[#F4F2EF] px-2 py-0.5 text-[12px] text-foreground"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <PayerContactsCard payer={payer} />
    </div>
  );
}
