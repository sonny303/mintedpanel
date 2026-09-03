// MP-1 / MP-2 — portal maintenance drawer: update URL (with trust-reset
// warning) and stop-using (unlink references + hide from pickers). Reuses
// updatePortalUrl / upsertGlobalPortal / publishTemplate — no new backend.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { useSops } from "@/hooks/useAdmin";
import { useSavePortalFormUrl, useStopUsingPortal } from "@/hooks/usePortals";
import { useFieldRegistryEditor } from "@/hooks/useFieldRegistryEditor";
import { PortalFieldRegistry } from "@/components/portals/PortalFieldRegistry";
import { fmtDate } from "@/lib/format";
import { displayPortalUrl, payerPortalStatus } from "@/lib/payerPortalsView";
import {
  isPortalHiddenFromPickers,
  listPortalStepReferences,
  portalDisplayName,
} from "@/lib/portalRetirement";
import { useCanWrite, useIsAdmin } from "@/lib/permissions";
import type { Portal } from "@/types";

const URL_RESET_WARNING =
  "Saving a new URL clears verification. This portal must be re-captured and re-proven in Minted Workbench.";

export interface PortalDrawerProps {
  portal: Portal;
  /** Payer context for deep links back into Form setup. */
  payerId: string;
  /** Template id preferred for the re-capture handoff (optional). */
  preferTemplateId?: string | null;
  onClose: () => void;
  /** Called after a successful URL save or stop-using so the parent can refresh selection. */
  onPortalUpdated?: (portal: Portal) => void;
}

export function PortalDrawer({
  portal,
  payerId,
  preferTemplateId,
  onClose,
  onPortalUpdated,
}: PortalDrawerProps) {
  const isAdmin = useIsAdmin();
  const canWrite = useCanWrite();
  const templatesQ = useSops();
  const saveUrlMut = useSavePortalFormUrl();
  const stopMut = useStopUsingPortal();
  // Same editor the Template Editor's Form setup step mounts — field maps are
  // portal-keyed, so training and drift repair belong to the portal, not to
  // whichever template step happens to link it.
  const registry = useFieldRegistryEditor({ portal });

  const [url, setUrl] = useState(portal.formUrl ?? "");
  const [confirmStop, setConfirmStop] = useState(false);
  const [ackUnlink, setAckUnlink] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const autoOpened = useRef(false);

  useEffect(() => {
    setUrl(portal.formUrl ?? "");
    setConfirmStop(false);
    setAckUnlink(false);
    setMappingOpen(false);
    autoOpened.current = false;
  }, [portal.id, portal.formUrl]);

  const driftCount = registry.staleIds.size;
  const status = payerPortalStatus({
    portal,
    mapCount: registry.rows.length,
    approvedCount: registry.approvedCount,
    driftCount,
  });

  const templates = useMemo(() => templatesQ.data ?? [], [templatesQ.data]);
  const refs = useMemo(
    () => listPortalStepReferences(templates, portal.portalKey),
    [templates, portal.portalKey],
  );

  const dirty = url.trim() !== (portal.formUrl ?? "").trim();
  const hidden = isPortalHiddenFromPickers(portal);
  const isGlobal = portal.orgId === null;
  // Mirror the Template Editor's rule so the same person keeps the same job:
  // shared rows are trained by any writer (the RPC is the real gate), org-tier
  // rows stay admin-only. Billing is read-only on both, unlike the editor.
  const canEditMaps = isGlobal ? canWrite : isAdmin;
  const needsAttention = registry.coverage.needsDecision > 0 || registry.staleIds.size > 0;
  const busy = saveUrlMut.isPending || stopMut.isPending;

  // Open the mapping block on the work, ONCE, when the maps land — the counts
  // are zero on mount (the query is still in flight), so an uncontrolled
  // `defaultOpen` reads false and a drifted form opens folded. Auto-open never
  // fires twice, so a deliberate collapse stays collapsed.
  useEffect(() => {
    if (autoOpened.current || !needsAttention) return;
    autoOpened.current = true;
    setMappingOpen(true);
  }, [needsAttention]);

  const recaptureTemplateId = preferTemplateId ?? refs[0]?.templateId ?? null;

  async function saveUrl() {
    if (!dirty) return;
    try {
      const after = await saveUrlMut.mutateAsync({ portal, formUrl: url });
      toast.success("Portal URL updated — re-capture in Workbench");
      onPortalUpdated?.(after);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the URL");
    }
  }

  async function confirmStopUsing() {
    if (!ackUnlink && refs.length > 0) return;
    try {
      const after = await stopMut.mutateAsync({ portal, templates });
      toast.success(
        refs.length > 0
          ? `Stopped using portal — unlinked ${refs.length} step${refs.length === 1 ? "" : "s"}`
          : "Portal hidden from pickers",
      );
      onPortalUpdated?.(after);
      setConfirmStop(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not stop using this portal");
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        {/* Wider than a two-field drawer needs: the field registry rows carry
            a token picker and wrap badly under ~700px. */}
        <DialogContent className="max-w-3xl gap-0 border-[#E8E5E0] p-0 shadow-none">
          <DialogHeader className="border-b border-[#E8E5E0] px-5 py-4">
            <DialogTitle className="text-[15px] font-semibold">
              {portalDisplayName(portal)}
            </DialogTitle>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Update the form URL or take this portal out of use. The portal key never changes.
            </p>
          </DialogHeader>

          <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Identity
              </h3>
              <div>
                <Label className="text-xs">Portal key</Label>
                <Input
                  value={portal.portalKey}
                  readOnly
                  className="mt-1 h-9 font-mono text-[12px]"
                  aria-describedby="portal-key-help"
                />
                <p id="portal-key-help" className="mt-1 text-[11px] text-muted-foreground">
                  Keys cannot be renamed — they join SOP steps, field maps, and fill logs.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill
                  status={isGlobal ? "brand" : "neutral"}
                  label={isGlobal ? "Global — inherited by every org" : "Org"}
                />
                <StatusPill status={status.tone} label={status.label} />
                {portal.provenAt ? (
                  <span className="text-[12px] text-muted-foreground">
                    Last proven {fmtDate(portal.provenAt)}
                  </span>
                ) : (
                  <span className="text-[12px] text-muted-foreground">Never proven</span>
                )}
              </div>
              {isGlobal && isAdmin ? (
                <p className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#92400E]">
                  Editing a global portal changes the URL every organization inherits.
                </p>
              ) : null}
            </section>

            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Form URL
              </h3>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!isAdmin || busy || hidden}
                aria-label="Form URL"
                className="h-9 font-mono text-[12px]"
                placeholder="https://…"
              />
              {dirty && isAdmin ? (
                <p className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#92400E]">
                  {URL_RESET_WARNING}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {isAdmin && !hidden ? (
                  <Button
                    size="sm"
                    className="h-8 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
                    disabled={!dirty || busy}
                    onClick={() => void saveUrl()}
                  >
                    {saveUrlMut.isPending ? "Saving…" : "Save URL"}
                  </Button>
                ) : null}
                {portal.formUrl ? (
                  <a
                    href={portal.formUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
                  >
                    Open portal in a new tab (does not capture)
                  </a>
                ) : (
                  <span className="text-[12px] text-muted-foreground">
                    No URL yet — {displayPortalUrl(null)}
                  </span>
                )}
              </div>
              {!portal.provenAt && portal.urlChangedAt ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#E8E5E0] bg-[#FAFAF9] px-3 py-2 text-[12px]">
                  <span className="text-muted-foreground">Needs capture after URL change.</span>
                  {recaptureTemplateId ? (
                    <Button asChild size="sm" variant="outline" className="h-7 text-[12px]">
                      <Link
                        to="/admin/templates/$id"
                        params={{ id: recaptureTemplateId }}
                        search={{ intent: "register" }}
                      >
                        Re-capture in Workbench
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline" className="h-7 text-[12px]">
                      <Link
                        to="/admin/payer-admin/setup/$payerId"
                        params={{ payerId }}
                        search={{ tab: "templates" }}
                      >
                        Open Templates
                      </Link>
                    </Button>
                  )}
                </div>
              ) : null}
            </section>

            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Used by
              </h3>
              {templatesQ.isLoading ? (
                <p className="text-[12px] text-muted-foreground">Loading references…</p>
              ) : refs.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  No template steps reference this portal.
                </p>
              ) : (
                <div className="overflow-hidden rounded-md border border-[#E8E5E0]">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-[#E8E5E0] bg-[#FAFAF9] text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Template</th>
                        <th className="px-3 py-2 font-medium">Action → step</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refs.map((ref) => (
                        <tr
                          key={`${ref.templateId}-${ref.taskIndex}-${ref.stepIndex}`}
                          className="border-b border-[#F0EEEA] last:border-0"
                        >
                          <td className="px-3 py-2">
                            <Link
                              to="/admin/templates/$id"
                              params={{ id: ref.templateId }}
                              className="font-medium text-foreground underline-offset-2 hover:underline"
                            >
                              {ref.templateName}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {ref.taskLabel} → {ref.stepLabel}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Field mapping, in the surface that owns the portal. The editor
                keeps the same block for first-time authoring; this one is the
                maintenance host — repair drift or re-decide a field after a
                URL change without opening a template. Opens on the work when
                there is any, stays folded when the form is settled. */}
            <section className="space-y-2 border-t border-[#E8E5E0] pt-3">
              <Collapsible open={mappingOpen} onOpenChange={setMappingOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex w-full items-center justify-between gap-2 text-left"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Field mapping
                      </h3>
                      {driftCount > 0 ? (
                        <StatusPill status="red" label={`${driftCount} broken`} />
                      ) : null}
                      {registry.coverage.needsDecision > 0 && driftCount === 0 ? (
                        <StatusPill
                          status="amber"
                          label={`${registry.coverage.needsDecision} to decide`}
                        />
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      {registry.coverage.mapped} of {registry.coverage.total} mapped
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3">
                  {registry.isLoading ? (
                    <p className="text-[12px] text-muted-foreground">Loading fields…</p>
                  ) : (
                    <PortalFieldRegistry
                      editor={registry}
                      canEdit={canEditMaps}
                      pickerModal
                      emptyState={
                        <p className="text-[12px] text-muted-foreground">
                          No fields captured yet. Capture runs in Minted Workbench on the live form
                          page.
                        </p>
                      }
                    />
                  )}
                </CollapsibleContent>
              </Collapsible>
            </section>

            {isAdmin && !hidden ? (
              <section className="space-y-2 border-t border-[#E8E5E0] pt-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Stop using this portal
                </h3>
                <p className="text-[12px] text-muted-foreground">
                  Hides the portal from every picker and unlinks the steps listed above. History,
                  field maps, and fill logs are kept. Hard delete is out of scope.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-[#FCA5A5] text-[#B91C1C] hover:bg-[#FEF2F2]"
                  disabled={busy}
                  onClick={() => {
                    setAckUnlink(refs.length === 0);
                    setConfirmStop(true);
                  }}
                >
                  Stop using this portal
                </Button>
              </section>
            ) : null}
            {hidden ? (
              <p className="rounded-md border border-[#E8E5E0] bg-[#FAFAF9] px-3 py-2 text-[12px] text-muted-foreground">
                This portal is hidden from pickers. It stays listed here for history.
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-[#E8E5E0] px-5 py-3">
            <Button variant="outline" size="sm" className="h-8" onClick={onClose} disabled={busy}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmStop ? (
        <Dialog open onOpenChange={(o) => !o && setConfirmStop(false)}>
          <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
            <DialogHeader>
              <DialogTitle>Stop using {portalDisplayName(portal)}?</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-[13px]">
              {refs.length > 0 ? (
                <>
                  <p>
                    <span className="font-semibold">{refs.length}</span> template step
                    {refs.length === 1 ? "" : "s"} reference this portal. Confirm unlink — those
                    steps will show as needing a portal.
                  </p>
                  <label className="flex items-start gap-2 text-[12.5px]">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={ackUnlink}
                      onChange={(e) => setAckUnlink(e.target.checked)}
                    />
                    <span>Unlink and stop using</span>
                  </label>
                </>
              ) : (
                <p>No template steps reference this portal. It will be hidden from pickers only.</p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmStop(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 bg-[#B91C1C] text-white hover:bg-[#991B1B]"
                disabled={busy || (refs.length > 0 && !ackUnlink)}
                onClick={() => void confirmStopUsing()}
              >
                {stopMut.isPending ? "Working…" : "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
