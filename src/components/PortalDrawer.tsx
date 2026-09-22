// MP-1 / MP-2 — portal maintenance drawer: update URL (with trust-reset
// warning) and stop-using (unlink references + hide from pickers). Reuses
// updatePortalUrl / upsertGlobalPortal / publishTemplate — no new backend.
// Confirm for stop-using is an inline reveal in this dialog (not a nested one).
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSops } from "@/hooks/useAdmin";
import { usePortalFieldMaps, useSavePortalFormUrl, useStopUsingPortal } from "@/hooks/usePortals";
import { useFormDrift } from "@/hooks/useFormDrift";
import { fmtDate } from "@/lib/format";
import { displayPortalUrl, payerPortalStatus } from "@/lib/payerPortalsView";
import {
  isPortalHiddenFromPickers,
  listPortalStepReferences,
  portalDisplayName,
} from "@/lib/portalRetirement";
import { useIsAdmin } from "@/lib/permissions";
import type { Portal } from "@/types";

const URL_RESET_WARNING =
  "Saving a new URL clears verification. Re-capture and re-prove in Workbench.";

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
  const templatesQ = useSops();
  const mapsQ = usePortalFieldMaps(portal.portalKey);
  const drift = useFormDrift();
  const saveUrlMut = useSavePortalFormUrl();
  const stopMut = useStopUsingPortal();

  const [url, setUrl] = useState(portal.formUrl ?? "");
  const [confirmStop, setConfirmStop] = useState(false);
  const [ackUnlink, setAckUnlink] = useState(false);
  const [ackGlobal, setAckGlobal] = useState(false);

  useEffect(() => {
    setUrl(portal.formUrl ?? "");
    setConfirmStop(false);
    setAckUnlink(false);
    setAckGlobal(false);
  }, [portal.id, portal.formUrl]);

  const maps = useMemo(
    () => (mapsQ.data ?? []).filter((m) => m.status !== "retired"),
    [mapsQ.data],
  );
  const approvedCount = maps.filter((m) => m.status === "approved").length;
  const driftCount = drift.driftByPortal.get(portal.portalKey)?.length ?? 0;
  const status = payerPortalStatus({
    portal,
    mapCount: maps.length,
    approvedCount,
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
  const busy = saveUrlMut.isPending || stopMut.isPending;

  const recaptureTemplateId = preferTemplateId ?? refs[0]?.templateId ?? null;

  const stopReady = (refs.length === 0 || ackUnlink) && (!isGlobal || ackGlobal);

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
    if (!stopReady) return;
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg gap-0 border-[#E8E5E0] p-0 shadow-none">
        <DialogHeader className="border-b border-[#E8E5E0] px-5 py-4">
          <DialogTitle className="text-[15px] font-semibold">
            {portalDisplayName(portal)}
          </DialogTitle>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Update the form URL or take this portal out of use.
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
                  Open portal
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
                      Open Form setup
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

          {isAdmin && !hidden ? (
            <section className="space-y-2 border-t border-[#E8E5E0] pt-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Stop using this portal
              </h3>
              {!confirmStop ? (
                <>
                  <p className="text-[12px] text-muted-foreground">
                    Hides the portal from pickers and unlinks the steps listed above. History, field
                    maps, and fill logs are kept.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 border-[#FCA5A5] text-[#B91C1C] hover:bg-[#FEF2F2]"
                    disabled={busy}
                    onClick={() => {
                      setAckUnlink(refs.length === 0);
                      setAckGlobal(false);
                      setConfirmStop(true);
                    }}
                  >
                    Stop using this portal
                  </Button>
                </>
              ) : (
                <div className="space-y-3 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-3">
                  <p className="text-[13px] font-medium text-[#991B1B]">
                    Stop using {portalDisplayName(portal)}?
                  </p>
                  {refs.length > 0 ? (
                    <p className="text-[12px] text-[#7F1D1D]">
                      <span className="font-semibold">{refs.length}</span> template step
                      {refs.length === 1 ? "" : "s"} will show as needing a portal.
                    </p>
                  ) : (
                    <p className="text-[12px] text-[#7F1D1D]">
                      No template steps reference this portal. It will be hidden from pickers only.
                    </p>
                  )}
                  {isGlobal ? (
                    <p className="text-[12px] text-[#7F1D1D]">
                      This is a global portal — every organization inherits the hide.
                    </p>
                  ) : null}
                  {refs.length > 0 ? (
                    <label className="flex items-start gap-2 text-[12.5px] text-[#7F1D1D]">
                      <Checkbox
                        checked={ackUnlink}
                        onCheckedChange={(v) => setAckUnlink(v === true)}
                        className="mt-0.5"
                        aria-label="Unlink and stop using"
                      />
                      <span>Unlink those steps and stop using</span>
                    </label>
                  ) : null}
                  {isGlobal ? (
                    <label className="flex items-start gap-2 text-[12.5px] text-[#7F1D1D]">
                      <Checkbox
                        checked={ackGlobal}
                        onCheckedChange={(v) => setAckGlobal(v === true)}
                        className="mt-0.5"
                        aria-label="Acknowledge global blast radius"
                      />
                      <span>I understand this affects every organization</span>
                    </label>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => setConfirmStop(false)}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 bg-[#B91C1C] text-white hover:bg-[#991B1B]"
                      disabled={busy || !stopReady}
                      onClick={() => void confirmStopUsing()}
                    >
                      {stopMut.isPending ? "Working…" : "Confirm stop using"}
                    </Button>
                  </div>
                </div>
              )}
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
  );
}
