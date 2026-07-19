// E6.5 F6.5.1 — the per-payer "Ready for business" funnel, the head of the
// consolidated Payer Setup workspace. One row per ACTIVE organization payer
// with honest, separate dimensions (global SOP / form state / drift) and ONE
// next step in the locked ladder: author SOP → register portal → train →
// repair drift → mock dry test → ready. Every form action deep-links the
// owning SOP editor (portal setup lives INSIDE the SOP form step since E6.5).
//
// Read-only posture (payer governance): payers are SELECTED from the catalog,
// never created or renamed here — no free-text creation, no identity edit.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { usePayerReadinessFunnel } from "@/hooks/usePayerReadinessFunnel";
import type { FunnelFormState, FunnelRow } from "@/lib/payerReadinessFunnel";

const FORM_STATE_PILL: Record<FunnelFormState, { label: string; tone: StatusColor }> = {
  none: { label: "No portal", tone: "neutral" },
  registered: { label: "Registered", tone: "amber" },
  trained: { label: "Trained", tone: "blue" },
  proven: { label: "Proven", tone: "green" },
};

function NextStepCell({ row }: { row: FunnelRow }) {
  switch (row.nextAction) {
    case "author_sop":
      return (
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/templates/new" search={{ payerId: row.payerId, tier: "global" }}>
            Author global SOP <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      );
    case "register_portal":
    case "train_mappings":
    case "repair_drift":
    case "run_dry_test": {
      const label =
        row.nextAction === "register_portal"
          ? "Register portal"
          : row.nextAction === "train_mappings"
            ? "Train mappings"
            : row.nextAction === "repair_drift"
              ? `Repair ${row.driftCount} broken mapping${row.driftCount === 1 ? "" : "s"}`
              : "Run mock dry test";
      if (!row.sopTemplateId) return <span className="text-[12.5px] text-gray-500">{label}</span>;
      return (
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/templates/$id" params={{ id: row.sopTemplateId }}>
            {label} <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      );
    }
    case "ready":
      return (
        <span className="inline-flex items-center gap-2">
          <StatusPill status="green" label="Ready for business" />
          {row.readyNote ? (
            <span className="text-[12px] text-gray-500">{row.readyNote}</span>
          ) : null}
        </span>
      );
  }
}

function FunnelTable({ rows }: { rows: FunnelRow[] }) {
  return (
    <div className="overflow-x-auto rounded-[6px] border border-gray-200 bg-white">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-gray-200 text-left text-[12px] text-gray-500">
            <th className="px-4 py-2.5 font-medium">Payer</th>
            <th className="px-4 py-2.5 font-medium">Global SOP</th>
            <th className="px-4 py-2.5 font-medium">Form</th>
            <th className="px-4 py-2.5 font-medium">Drift</th>
            <th className="px-4 py-2.5 font-medium">Next step</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const form = FORM_STATE_PILL[row.formState];
            return (
              <tr key={row.payerId} className="border-b border-gray-100 last:border-b-0">
                <td className="px-4 py-2.5 font-medium text-gray-900">{row.payerName}</td>
                <td className="px-4 py-2.5">
                  {row.sopPublished ? (
                    <StatusPill
                      status="green"
                      label={row.sopCount === 1 ? "Published" : `Published ×${row.sopCount}`}
                    />
                  ) : (
                    <StatusPill status="amber" label="Needs SOP" />
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {row.needsPortal || row.formState !== "none" ? (
                    <StatusPill status={form.tone} label={form.label} />
                  ) : (
                    <span className="text-[12px] text-gray-500">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {row.driftCount > 0 ? (
                    <StatusPill status="red" label={`${row.driftCount} broken`} />
                  ) : (
                    <span className="text-[12px] text-gray-500">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <NextStepCell row={row} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PayerReadinessFunnel() {
  const { rows, isLoading, isError } = usePayerReadinessFunnel();
  const [showNotStarted, setShowNotStarted] = useState(false);

  const { started, notStarted } = useMemo(() => {
    const all = rows ?? [];
    return {
      started: all.filter((r) => r.started),
      notStarted: all.filter((r) => !r.started),
    };
  }, [rows]);

  if (isLoading) return <p className="text-[13px] text-gray-500">Loading payer readiness…</p>;
  if (isError) {
    return <p className="text-[13px] text-[#B91C1C]">Couldn't load payer readiness.</p>;
  }
  if ((rows ?? []).length === 0) {
    return (
      <EmptyState message="No payers selected yet. Select payers from the catalog below — readiness tracking starts the moment one is selected." />
    );
  }

  return (
    <section aria-labelledby="payer-funnel-heading" className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h2 id="payer-funnel-heading" className="text-[15px] font-semibold">
            Ready for business
          </h2>
          <p className="text-[12.5px] text-muted-foreground">
            Per-payer platform readiness: a published global SOP plus a registered, trained, and
            dry-run-proven form when the SOP fills one.
          </p>
        </div>
        {notStarted.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[12.5px]"
            onClick={() => setShowNotStarted((v) => !v)}
          >
            {showNotStarted ? "Hide" : "Show"} not started ({notStarted.length})
          </Button>
        ) : null}
      </div>
      {started.length > 0 ? (
        <FunnelTable rows={started} />
      ) : (
        <p className="text-[13px] text-gray-500">
          Nothing in motion yet — author a global SOP for a payer to start its funnel.
        </p>
      )}
      {showNotStarted && notStarted.length > 0 ? <FunnelTable rows={notStarted} /> : null}
    </section>
  );
}
