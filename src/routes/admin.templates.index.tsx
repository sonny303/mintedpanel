// Admin > Templates list. One row per SOP template with its match key (Payer,
// State, Specialty, Group), task count, and last-updated. Archived excluded by
// default. Row click opens the wizard in edit mode; "+ New Template" (admin
// only) opens the wizard in create mode.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { fmtDate } from "@/lib/format";
import { useDebounced } from "@/hooks/useDebounced";
import { Plus } from "lucide-react";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePayers, useSops } from "@/hooks/useAdmin";
import { useProviderGroups } from "@/hooks/useLookups";
import { useSopTemplateDrafts } from "@/hooks/useSopTemplateDrafts";
import { fmtDateTime } from "@/lib/format";
import { useIsAdmin } from "@/lib/permissions";
import { isFallbackTemplate } from "@/lib/pickTemplate";
import { cn } from "@/lib/utils";
import type { SOPTemplate } from "@/types";

type TemplateRow = SOPTemplate & { archived?: boolean; isArchived?: boolean };

function isTemplateArchived(template: TemplateRow): boolean {
  return Boolean(template.archived ?? template.isArchived ?? false);
}

export const Route = createFileRoute("/admin/templates/")({
  component: TemplatesIndex,
});

function TemplatesIndex() {
  const canEdit = useIsAdmin();
  const navigate = useNavigate();
  const templatesQ = useSops();
  const payersQ = usePayers();
  const groupsQ = useProviderGroups();
  const draftsQ = useSopTemplateDrafts();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [showArchived, setShowArchived] = useState(false);

  const payerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of payersQ.data ?? []) m.set(p.id, p.name);
    return m;
  }, [payersQ.data]);

  const groupName = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groupsQ.data ?? []) m.set(g.id, g.name);
    return m;
  }, [groupsQ.data]);

  const rows = useMemo(() => {
    const all = (templatesQ.data ?? []) as TemplateRow[];
    const term = debouncedSearch.trim().toLowerCase();
    return all
      .filter((t) => (showArchived ? true : !isTemplateArchived(t)))
      .filter((t) => (term ? t.name.toLowerCase().includes(term) : true));
  }, [templatesQ.data, debouncedSearch, showArchived]);

  return (
    <div className="p-6">
      <PageHeader
        title="Templates"
        description="Reusable SOP definitions. A case resolves the most specific match by payer + state + group — an organization SOP overrides a global payer SOP, and the generic fallback applies only when no payer SOP matches."
        actions={
          canEdit ? (
            <Button
              onClick={() => navigate({ to: "/admin/templates/new" })}
              style={{ backgroundColor: "#1B4D3E" }}
              className="text-white hover:opacity-90"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          ) : null
        }
      />

      {!canEdit ? (
        <div className="mb-4 rounded-md border border-[#E8E5E0] bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Read-only view. Only admins can edit templates.
        </div>
      ) : null}

      {/* E4.2 F4.2.1 — save-as-draft WIP (visible to any admin for handoff). */}
      {canEdit && (draftsQ.data?.length ?? 0) > 0 ? (
        <div className="mb-4 rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3">
          <p className="text-[13px] font-medium text-[#92400E]">Drafts in progress</p>
          <ul className="mt-2 space-y-1">
            {(draftsQ.data ?? []).map((d) => {
              const draftName =
                (d.payload as { name?: string } | null)?.name?.trim() || "Untitled draft";
              return (
                <li key={d.id} className="flex items-center gap-2 text-[13px] text-[#92400E]">
                  <span className="font-medium">{draftName}</span>
                  <span className="text-[12px]">
                    updated {fmtDateTime(d.updatedAt)}
                    {d.updatedByName ? ` by ${d.updatedByName}` : ""}
                  </span>
                  <Link
                    to="/admin/templates/new"
                    search={{ draftId: d.id }}
                    className="ml-auto text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
                  >
                    Resume
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center gap-3 mb-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates"
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      <div className="rounded-md border border-[#E8E5E0] overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/30">
            <tr className="text-xs uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-3 h-10 font-medium">Name</th>
              <th className="text-left px-3 h-10 font-medium">Payer</th>
              <th className="text-left px-3 h-10 font-medium">State</th>
              <th className="text-left px-3 h-10 font-medium">Specialty (legacy)</th>
              <th className="text-left px-3 h-10 font-medium">Group</th>
              <th className="text-left px-3 h-10 font-medium">Tasks</th>
              <th className="text-left px-3 h-10 font-medium">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {templatesQ.isLoading ? (
              <TableSkeletonRows rows={6} cols={7} />
            ) : templatesQ.isError ? (
              <tr>
                <td className="px-3 py-12 text-center" colSpan={7}>
                  <EmptyState
                    message="Failed to load templates"
                    action={
                      <Button variant="outline" size="sm" onClick={() => templatesQ.refetch()}>
                        Retry
                      </Button>
                    }
                  />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-3 py-12" colSpan={7}>
                  <EmptyState message="No templates yet" />
                </td>
              </tr>
            ) : (
              rows.map((t) => (
                <tr
                  key={t.id}
                  className={cn(
                    "border-t border-[#E8E5E0] hover:bg-muted/40 cursor-pointer",
                    isTemplateArchived(t) ? "opacity-70" : undefined,
                  )}
                  onClick={() => navigate({ to: "/admin/templates/$id", params: { id: t.id } })}
                >
                  <td className="px-3 h-10 text-sm">
                    <Link
                      to="/admin/templates/$id"
                      params={{ id: t.id }}
                      className="font-medium text-foreground hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.name}
                    </Link>
                    {isFallbackTemplate(t) ? (
                      <span className="ml-2 inline-flex items-center rounded-full border border-[#E8E5E0] px-2 py-0.5 text-xs text-muted-foreground">
                        Fallback — used when no payer SOP matches
                      </span>
                    ) : (t as TemplateRow & { orgId: string | null }).orgId === null ? (
                      // E4.2 F4.2.1 — template tier: global/shared vs org-specific.
                      <span className="ml-2 inline-flex items-center rounded-full border border-[#E8E5E0] px-2 py-0.5 text-xs text-muted-foreground">
                        Global — shared across orgs
                      </span>
                    ) : null}
                    {isTemplateArchived(t) ? (
                      <span className="ml-2 inline-flex items-center rounded-full border border-[#E8E5E0] px-2 py-0.5 text-xs text-muted-foreground">
                        Archived
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 h-10 text-sm">
                    {t.payerId ? (payerName.get(t.payerId) ?? "—") : "—"}
                  </td>
                  <td className="px-3 h-10 text-sm">{t.state ?? "—"}</td>
                  <td className="px-3 h-10 text-sm">{t.specialty ?? "—"}</td>
                  <td className="px-3 h-10 text-sm">
                    {t.groupId ? (groupName.get(t.groupId) ?? "—") : "—"}
                  </td>
                  <td className="px-3 h-10 text-sm tabular-nums">
                    {t.taskDefinitions?.length ?? 0}
                  </td>
                  <td className="px-3 h-10 text-sm text-muted-foreground">
                    {fmtDate(t.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
