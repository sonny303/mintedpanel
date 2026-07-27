// 2026-07-20 catalog UX pass (item 8) — the per-payer drill-in behind the
// catalog list, modeled on the provider record: one read-only page carrying
// everything the org knows about a catalog payer. Identity is Minted-curated
// (orgs SELECT payers, never edit them — the E4.2 governance posture), so the
// only mutations here are the SAME network-subscription actions the list's
// Manage column offers (add / reactivate / remove via org_payer_assignments);
// admin-gated, RLS/RPC-backstopped. Reads compose the existing caches: the
// catalog RPC list (list_global_payers — getPayer's RLS or-filter can't see
// UNASSIGNED global rows, so the detail must resolve from the same RPC read
// the list uses), org assignments, SOP templates, and the portals registry.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { PortalVerificationPill } from "@/components/portals/PortalVerificationPill";
import { RemovePayerConfirmDialog } from "@/components/payers/PayerCatalogBrowser";
import { useGlobalPayers } from "@/hooks/usePayerCatalog";
import {
  useAddAssignment,
  useOrgPayerAssignments,
  useReactivateAssignment,
} from "@/hooks/useOrgPayerAssignments";
import { useSops } from "@/hooks/useAdmin";
import { usePortals } from "@/hooks/usePortals";
import { useIsAdmin } from "@/lib/permissions";
import { assignmentsByPayerId, catalogAction } from "@/lib/payerCatalogActions";
import { PAYER_KIND_LABELS } from "@/lib/payerDirectory";
import type { OrgPayerAssignment, Payer, PayerKind } from "@/types";

const KIND_PILL: Record<PayerKind, StatusColor> = {
  commercial: "brand",
  medicare: "blue",
  medicaid: "teal",
  medicaid_mco: "teal",
  medicare_advantage: "blue",
  tricare: "violet",
};

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[#E8E5E0] bg-white p-4">
      <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

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

export function PayerDetailContent({ payerId }: { payerId: string }) {
  const payersQ = useGlobalPayers();
  const assignmentsQ = useOrgPayerAssignments();
  const sopsQ = useSops();
  const portalsQ = usePortals();
  const isAdmin = useIsAdmin();
  const addMut = useAddAssignment();
  const reactivateMut = useReactivateAssignment();
  const [removing, setRemoving] = useState<Payer | null>(null);

  const payers = useMemo(() => payersQ.data ?? [], [payersQ.data]);
  const payer = useMemo(() => payers.find((p) => p.id === payerId) ?? null, [payers, payerId]);
  const payerById = useMemo(() => new Map(payers.map((p) => [p.id, p])), [payers]);
  const assignment = useMemo(
    () =>
      assignmentsByPayerId((assignmentsQ.data as OrgPayerAssignment[] | undefined) ?? []).get(
        payerId,
      ),
    [assignmentsQ.data, payerId],
  );

  const sops = useMemo(
    () => (sopsQ.data ?? []).filter((t) => t.payerId === payerId && !t.archived),
    [sopsQ.data, payerId],
  );
  const portals = useMemo(
    () => (portalsQ.data ?? []).filter((p) => p.payerId === payerId),
    [portalsQ.data, payerId],
  );

  const backLink = (
    <Link
      to="/admin/payer-admin/catalog"
      className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
    >
      ← Back to catalog
    </Link>
  );

  if (payersQ.isError) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-[13px] text-[#B91C1C]">
          Couldn&apos;t load the payer catalog.{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => payersQ.refetch()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (payersQ.data === undefined) {
    return (
      <div className="space-y-4">
        {backLink}
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!payer) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="rounded-md border border-[#E8E5E0] p-6 text-center">
          <p className="text-[13px] font-medium">Payer not found</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            This payer isn&apos;t in the catalog (or the link is stale).
          </p>
        </div>
      </div>
    );
  }

  const kind = payer.payerKind ?? "commercial";
  const status = payer.status ?? "active";
  const action = catalogAction(payer, assignment, payerById);
  const canManage = isAdmin && assignmentsQ.data !== undefined;
  const pending = addMut.isPending || reactivateMut.isPending;

  const handleAdd = () => {
    addMut.mutate(payer.id, {
      onSuccess: () =>
        toast.success(`${payer.name} added to your network — configure credentialing scope next.`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add the payer"),
    });
  };
  const handleReactivate = () => {
    reactivateMut.mutate(payer.id, {
      onSuccess: () => toast.success(`${payer.name} reactivated`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't reactivate the payer"),
    });
  };

  return (
    <div className="space-y-4">
      {backLink}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{payer.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusPill status={KIND_PILL[kind]} label={PAYER_KIND_LABELS[kind]} />
            {status === "active" ? null : (
              <StatusPill status="neutral" label={status === "merged" ? "Merged" : "Retired"} />
            )}
            {action.kind === "added" ? <StatusPill status="green" label="In my network" /> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {action.kind === "unavailable" ? (
            <span className="text-[12px] text-muted-foreground">
              {action.reason === "merged" ? "Merged" : "Retired"} — can&apos;t be added
              {action.reason === "merged" && action.successor ? (
                <>
                  {" · use "}
                  <span className="text-foreground">{action.successor.name}</span>
                </>
              ) : null}
            </span>
          ) : null}
          {canManage && action.kind === "add" ? (
            <Button
              size="sm"
              className="h-8 bg-[#1B4D3E] px-3 text-[12px] text-white hover:bg-[#163F33]"
              disabled={pending}
              onClick={handleAdd}
            >
              Add to my network
            </Button>
          ) : null}
          {canManage && action.kind === "reactivate" ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-[12px]"
              disabled={pending}
              onClick={handleReactivate}
            >
              Reactivate
            </Button>
          ) : null}
          {canManage && action.kind === "added" ? (
            <>
              <Button asChild variant="outline" size="sm" className="h-8 px-3 text-[12px]">
                <Link to="/onboarding/wizard" search={{ section: "payer_network" }}>
                  Configure credentialing scope
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-[12px] text-[#B91C1C] hover:bg-[#FEF2F2]"
                onClick={() => setRemoving(payer)}
              >
                Remove from my network
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <SectionCard title="Identity">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Fact label="Catalog key" value={payer.payerSlug || "—"} />
          {/* E6.7 F6.7.5: stored avg_decision_days is no longer rendered — the
              sync that curated it retired; a derived replacement (median
              created→approved from case outcomes) is logged in TECH-DEBT.md. */}
          {/* 2026-07-20 re-scope: what this payer calls its payer-issued
              enrollment ID — a Minted-curated payer-definition fact (the
              per-org override table is retired). Issued VALUES are captured
              on provider enrollment facts and group Payer Network entries. */}
          <Fact
            label="Identifier label"
            value={
              payer.resolutionIdLabel?.trim()
                ? payer.resolutionIdLabel
                : "Payer-issued ID (generic)"
            }
          />
          <Fact
            label="Aliases"
            value={(payer.aliases ?? []).length > 0 ? (payer.aliases ?? []).join(" · ") : "—"}
          />
        </dl>
        {payer.delegationNote?.trim() ? (
          <div className="mt-3 rounded-[4px] border border-[#FDE68A] bg-[#FEF3C7] px-2 py-1.5 text-[12px] text-[#92400E]">
            Delegated: {payer.delegationNote}
          </div>
        ) : null}
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          Payer identity is Minted-curated — organizations select payers from the catalog and manage
          their own network and scope; they never edit catalog facts.
        </p>
      </SectionCard>

      <SectionCard title={`State coverage (${(payer.states ?? []).length})`}>
        {(payer.states ?? []).length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No state coverage recorded.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(payer.states ?? []).map((s) => (
              <span
                key={s}
                className="rounded-[4px] bg-[#F4F2EF] px-2 py-0.5 text-[12px] text-foreground"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="SOP templates for this payer">
        {sopsQ.isError ? (
          <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load SOP templates.</p>
        ) : sopsQ.data === undefined ? (
          <Skeleton className="h-8 w-full" />
        ) : sops.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No SOP templates match this payer yet — cases would resolve the generic fallback SOP.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {sops.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                <Link
                  to="/admin/templates/$id"
                  params={{ id: t.id }}
                  className="font-medium text-[#1B4D3E] underline underline-offset-2"
                >
                  {t.name}
                </Link>
                <span className="text-muted-foreground">
                  {t.state ?? "Any state"} ·{" "}
                  {t.orgId === null ? "Global payer SOP" : "Organization override"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Portals for this payer">
        {portalsQ.isError ? (
          <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load the portal registry.</p>
        ) : portalsQ.data === undefined ? (
          <Skeleton className="h-8 w-full" />
        ) : portals.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No portals registered for this payer.</p>
        ) : (
          <ul className="space-y-1.5">
            {portals.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-medium text-foreground">{p.name}</span>
                <span className="rounded-[4px] bg-[#F4F2EF] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {p.portalKey}
                </span>
                <PortalVerificationPill portal={p} />
                {p.formUrl ? (
                  <a
                    href={p.formUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-[#1B4D3E] underline underline-offset-2"
                  >
                    Open portal
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {removing ? (
        <RemovePayerConfirmDialog payer={removing} onClose={() => setRemoving(null)} />
      ) : null}
    </div>
  );
}
