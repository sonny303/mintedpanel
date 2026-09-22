// E2.2 F2.2.1/F2.2.2 — "Generated from <SOP name> v<N>" on the case surface,
// one line per distinct stamped (template, version) pair across the case's
// tasks (a reapplied case shows both cycles). The name comes from the
// IMMUTABLE version row (head name at publish time) — a later rename never
// rewrites history — and the label opens E1.7b's read-only version view
// (F1.7b.2) directly on that version. A fallback-stamped pair carries the
// neutral "Generic SOP" pill (TE-3 structural identity via the templates
// cache). An unresolvable stamp (cross-org/unreadable version row, or a
// template hard-deleted after this case was generated) renders a neutral
// "unknown template" — never an error. Legacy tasks and post-delete null
// stamps contribute no pairs, so those cases render exactly as before.
import { useState } from "react";
import { FileText } from "lucide-react";
import { StatusPill } from "@/components/StatusPill";
import { TemplateVersionHistoryDialog } from "@/components/templates/TemplateVersionHistory";
import { useSops, useTemplateVersion } from "@/hooks/useAdmin";
import { usePortals } from "@/hooks/usePortals";
import { isFallbackTemplate } from "@/lib/pickTemplate";
import { distinctStampPairs } from "@/lib/sopStamp";
import type { Task } from "@/types";

export function CaseSopProvenance({ tasks }: { tasks: Task[] }) {
  const pairs = distinctStampPairs(tasks);
  if (pairs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {pairs.map((p) => (
        <ProvenanceLine
          key={`${p.sopTemplateId}|${p.sopVersion}`}
          templateId={p.sopTemplateId}
          version={p.sopVersion}
        />
      ))}
    </div>
  );
}

function ProvenanceLine({ templateId, version }: { templateId: string; version: number }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const templatesQ = useSops();
  const portalsQ = usePortals();
  const versionQ = useTemplateVersion(templateId, version);

  const template = (templatesQ.data ?? []).find((t) => t.id === templateId) ?? null;
  const isGeneric = template !== null && isFallbackTemplate(template);

  if (versionQ.isLoading) return null;

  const versionRow = versionQ.data ?? null;
  if (!versionRow) {
    return (
      <span className="text-[12px] text-muted-foreground">Generated from an unknown template</span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
      <FileText className="h-4 w-4 shrink-0" />
      <span>
        Generated from{" "}
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
        >
          {versionRow.name} v{versionRow.version}
        </button>
      </span>
      {isGeneric ? <StatusPill status="neutral" label="Generic SOP" /> : null}
      {historyOpen ? (
        <TemplateVersionHistoryDialog
          templateId={templateId}
          currentVersion={template?.currentVersion ?? versionRow.version}
          initialViewing={versionRow.version}
          portals={portalsQ.data ?? []}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </span>
  );
}
