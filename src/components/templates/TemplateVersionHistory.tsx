// E1.7b F1.7b.2 — version history + read-only per-version view. A dialog with
// two states: the history table (version, date, publisher, change note; the
// head marked "Current"), and a selected version rendered read-only through
// the SAME preview the wizard's Review step uses, so a past version is traced
// to its exact content. Version rows are immutable — the viewer never edits.
//
// Slice F versioning-lite: non-current versions carry a "Restore as vN+1"
// action that copies the old version forward AS A NEW version through the
// SAME publish RPC (optimistic concurrency included) — publishing never edits
// an old version, and cases in flight keep the version they started on.
import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { EmptyState } from "@/components/EmptyState";
import { TemplatePreviewTasks } from "@/components/templates/TemplatePreviewTasks";
import { usePublishSop, useTemplateVersion, useTemplateVersions } from "@/hooks/useAdmin";
import { fmtDateTime } from "@/lib/format";
import { SopVersionConflictError } from "@/services/templates";
import type { Portal, SOPTemplateVersion } from "@/types";

export function TemplateVersionHistoryDialog({
  templateId,
  currentVersion,
  portals,
  onClose,
  initialViewing,
  canRestore,
}: {
  templateId: string;
  currentVersion: number;
  portals: Portal[];
  onClose: () => void;
  /** Open directly on one version's read-only view (E2.2 case provenance);
   * "All versions" still steps back to the history table. */
  initialViewing?: number;
  /** Slice F — offer "Restore as new" on non-current versions. Restoring
   * publishes the old version's content as version N+1 and replaces the
   * editor's working copy, so callers should pass the same edit permission
   * the wizard computes. Read-only surfaces (case provenance) omit it. */
  canRestore?: boolean;
}) {
  const [viewing, setViewing] = useState<number | null>(initialViewing ?? null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const versionsQ = useTemplateVersions(templateId);
  const versionQ = useTemplateVersion(templateId, viewing);
  const publishMut = usePublishSop(templateId);

  async function restore(v: SOPTemplateVersion) {
    setRestoring(v.version);
    try {
      const result = await publishMut.mutateAsync({
        expectedVersion: currentVersion,
        name: v.name,
        taskDefinitions: v.taskDefinitions ?? [],
        changeNote: `Restored from v${v.version}`,
        requiredProfileAttributes: v.requiredProfileAttributes ?? [],
      });
      toast.success(`Restored v${v.version} as v${result.version}`);
      onClose();
    } catch (err) {
      if (err instanceof SopVersionConflictError) {
        toast.error("Someone else published a newer version — reload to see it.");
      } else {
        toast.error(err instanceof Error ? err.message : "Restore failed");
      }
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{viewing !== null ? `Version ${viewing}` : "Version history"}</DialogTitle>
        </DialogHeader>

        {viewing === null ? (
          <div className="space-y-2">
            <div className="rounded-md border border-[#E8E5E0] overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/30">
                  <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-3 h-10 font-medium">Version</th>
                    <th className="text-left px-3 h-10 font-medium">Published</th>
                    <th className="text-left px-3 h-10 font-medium">By</th>
                    <th className="text-left px-3 h-10 font-medium">Change note</th>
                    {canRestore ? <th className="px-3 h-10" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {versionsQ.isLoading ? (
                    <TableSkeletonRows rows={3} cols={canRestore ? 5 : 4} />
                  ) : (versionsQ.data ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={canRestore ? 5 : 4} className="p-6">
                        <EmptyState message="No versions yet" />
                      </td>
                    </tr>
                  ) : (
                    (versionsQ.data ?? []).map((v) => (
                      <tr
                        key={v.id}
                        onClick={() => setViewing(v.version)}
                        className="border-t border-[#E8E5E0] cursor-pointer hover:bg-muted/30"
                      >
                        <td className="px-3 h-10 text-sm tabular-nums">
                          <span className="font-medium">v{v.version}</span>
                          {v.version === currentVersion ? (
                            <span className="ml-2 inline-flex items-center rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-[11px] text-[#059669]">
                              Current
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 h-10 text-sm text-muted-foreground">
                          {fmtDateTime(v.publishedAt)}
                        </td>
                        <td className="px-3 h-10 text-sm text-muted-foreground">
                          {v.publishedByName ?? "—"}
                        </td>
                        <td className="px-3 h-10 text-sm text-muted-foreground max-w-[280px] truncate">
                          {v.changeNote ?? "—"}
                        </td>
                        {canRestore ? (
                          <td className="px-3 h-10 text-right">
                            {v.version !== currentVersion ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={restoring !== null}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void restore(v);
                                }}
                              >
                                {restoring === v.version
                                  ? "Restoring…"
                                  : `Restore as v${currentVersion + 1}`}
                              </Button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Publishing never edits an old version — cases in flight keep the version they started
              on. Restoring copies an old version forward as a new one.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={() => setViewing(null)}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                All versions
              </Button>
              <span className="text-xs text-muted-foreground">
                {viewing === currentVersion
                  ? `Current version ${currentVersion}`
                  : `Read-only snapshot — current version is ${currentVersion}`}
              </span>
            </div>
            <Separator />
            {versionQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : versionQ.data ? (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="font-medium">{versionQ.data.name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · published {fmtDateTime(versionQ.data.publishedAt)}
                    {versionQ.data.publishedByName ? ` by ${versionQ.data.publishedByName}` : ""}
                  </span>
                  {versionQ.data.changeNote ? (
                    <p className="text-muted-foreground mt-1">{versionQ.data.changeNote}</p>
                  ) : null}
                </div>
                {canRestore && viewing !== currentVersion ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={restoring !== null}
                    onClick={() => versionQ.data && void restore(versionQ.data)}
                  >
                    {restoring === viewing ? "Restoring…" : `Restore as v${currentVersion + 1}`}
                  </Button>
                ) : null}
                <TemplatePreviewTasks
                  tasks={versionQ.data.taskDefinitions ?? []}
                  portals={portals}
                />
              </div>
            ) : (
              <EmptyState message="Version not found" />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
