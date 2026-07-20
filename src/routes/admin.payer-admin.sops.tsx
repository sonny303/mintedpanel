// E6.5 F6.5.1/F6.5.4 — Payer Setup / SOPs: the authoring workspace. Drift
// repair is queue-first: any portal whose last REAL fill reported broken
// mappings gets a banner up top deep-linking the OWNING SOP editor (where the
// F6.5.2 form step panel queues broken mappings first). Below it, the shared
// templates list (org overrides + global SOPs; the wizard routes unchanged).
import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { PayerAdminTabs } from "@/components/payer-admin/PayerAdminTabs";
import { TemplatesList } from "@/components/templates/TemplatesList";
import { useFormDrift } from "@/hooks/useFormDrift";
import { useSops } from "@/hooks/useAdmin";
import { usePortals } from "@/hooks/usePortals";
import { sopOnlineFormNeeds } from "@/lib/payerReadinessFunnel";

export const Route = createFileRoute("/admin/payer-admin/sops")({
  component: SopsTab,
});

interface DriftBannerRow {
  portalKey: string;
  portalName: string;
  count: number;
  labels: string[];
  /** The SOP whose online_form step carries this portal key (repair home). */
  templateId: string | null;
  templateName: string | null;
}

function SopsTab() {
  const drift = useFormDrift();
  const templatesQ = useSops();
  const portalsQ = usePortals();

  const banners = useMemo<DriftBannerRow[]>(() => {
    if (drift.driftByPortal.size === 0) return [];
    const portalName = new Map((portalsQ.data ?? []).map((p) => [p.portalKey, p.name]));
    // The owning SOP = the first template whose online_form steps name the key.
    const templateByKey = new Map<string, { id: string; name: string }>();
    for (const t of templatesQ.data ?? []) {
      if (t.archived) continue;
      for (const key of sopOnlineFormNeeds(t.taskDefinitions).portalKeys) {
        if (!templateByKey.has(key)) templateByKey.set(key, { id: t.id, name: t.name });
      }
    }
    return [...drift.driftByPortal.entries()].map(([portalKey, maps]) => ({
      portalKey,
      portalName: portalName.get(portalKey) ?? portalKey,
      count: maps.length,
      labels: maps.map((m) => m.fieldLabel ?? m.selector),
      templateId: templateByKey.get(portalKey)?.id ?? null,
      templateName: templateByKey.get(portalKey)?.name ?? null,
    }));
  }, [drift.driftByPortal, portalsQ.data, templatesQ.data]);

  return (
    <div>
      <PageHeader
        title="Payer Setup"
        description="Author global SOPs, set up their portal forms, and repair drift — one editor for the whole loop."
      />
      <div className="mt-2 space-y-6">
        <PayerAdminTabs active="sops" />
        {banners.length > 0 ? (
          <section aria-label="Broken form mappings" className="space-y-2">
            {banners.map((b) => (
              <div
                key={b.portalKey}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5"
              >
                <div className="text-[13px] text-[#B91C1C]">
                  <span className="font-semibold">
                    {b.count} mapping{b.count === 1 ? "" : "s"} broke
                  </span>{" "}
                  on the last real fill of {b.portalName}
                  <span className="text-[12px]"> — {b.labels.slice(0, 3).join(", ")}</span>
                  {b.labels.length > 3 ? (
                    <span className="text-[12px]"> +{b.labels.length - 3} more</span>
                  ) : null}
                </div>
                {b.templateId ? (
                  <Button asChild size="sm" variant="outline" className="h-7">
                    <Link to="/admin/templates/$id" params={{ id: b.templateId }}>
                      Open {b.templateName ?? "SOP"} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                ) : (
                  <span className="text-[12px] text-[#B91C1C]">
                    No SOP step links this portal yet
                  </span>
                )}
              </div>
            ))}
          </section>
        ) : null}
        <TemplatesList />
      </div>
    </div>
  );
}
