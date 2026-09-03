// E6.5 F6.5.2/F6.5.4 — the in-editor form machinery for an online_form SOP
// step: register/pick the portal and train its captured mappings (broken
// mappings queue FIRST). Capture and mock dry-run / Mark proven live in the
// Workbench extension Train forms tab — proven is never stamped from here.
//
// Self-contained by design: it fetches through its own org-cached hooks (keyed
// by portalKey) and takes only primitives + row-local callbacks from
// TemplateTaskRow, so the wizard's memo/useCallback render contract stays
// intact (TemplateTaskRow.test.ts + template-typing-latency.spec.ts). The
// panel renders COLLAPSED by default — a summary line only — so Step 3 typing
// never pays for its content.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { usePortals } from "@/hooks/usePortals";
import { useUpsertGlobalPortal } from "@/hooks/useGlobalAuthoring";
import { useCreatePortal } from "@/hooks/usePortals";
import { useFieldRegistryEditor } from "@/hooks/useFieldRegistryEditor";
import { normalizePortalKey } from "@/lib/tokenFormat";
import { queryKeys } from "@/hooks/queryKeys";
import { PortalDrawer } from "@/components/portals/PortalDrawer";
import { PortalFieldRegistry } from "@/components/portals/PortalFieldRegistry";
import { portalDisplayName } from "@/lib/portalRetirement";
import { useLocation } from "@tanstack/react-router";

export interface FormStepPanelProps {
  /** The step's portal key, already normalized (null = no portal linked). */
  portalKey: string | null;
  templatePayerId: string | null;
  canEdit: boolean;
  /** The template is a GLOBAL row — register/train against the global tier. */
  isGlobalAuthoring: boolean;
  /** Slice F — a readiness deep-link (?intent=) lands on this step: mount the
   * panel EXPANDED so the link lands on the work. Read once at mount; every
   * other panel keeps the collapsed default (the latency contract). */
  defaultOpen?: boolean;
  /** Bumped by the portal picker's "Register portal" CTA — expands Form setup
   * and opens the register dialog. Admin > Portals is a redirect shell; this
   * is the only live registration surface. */
  openRegisterSignal?: number;
  /** Writes the registered portal's key back onto the step. */
  onPortalKeyChange?: (portalKey: string) => void;
}

export function FormStepPanel({
  portalKey,
  templatePayerId,
  canEdit,
  isGlobalAuthoring,
  defaultOpen,
  openRegisterSignal = 0,
  onPortalKeyChange,
}: FormStepPanelProps) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [registerOpen, setRegisterOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // PortalStepSelect's "Register portal" button (and the empty-registry path)
  // bumps the signal so registration stays one click away without a dead
  // Admin > Portals hop. Ignore the initial 0 so ordinary mounts stay quiet.
  useEffect(() => {
    if (openRegisterSignal <= 0) return;
    setOpen(true);
    setRegisterOpen(true);
  }, [openRegisterSignal]);

  // Re-expand when an intent deep-link lands (pathname/search change).
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen, location.pathname]);

  const orgId = useActiveOrgId() ?? "no-org";
  const qc = useQueryClient();
  const portalsQ = usePortals();

  const portal = useMemo(
    () =>
      portalKey
        ? (portalsQ.data ?? []).find((p) => normalizePortalKey(p.portalKey) === portalKey)
        : undefined,
    [portalsQ.data, portalKey],
  );

  // Every training write lives here, shared with the Portals drawer. The step
  // contributes nothing to it but the key.
  const registry = useFieldRegistryEditor({ portal, portalKey });

  async function copyReturnLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Return link copied");
    } catch {
      toast.error("Could not copy the return link");
    }
  }

  // Queue-first ordering (F6.5.4) and the coverage read-out come from the
  // shared editor: broken mappings lead, then undecided (proposed) captures.
  const { rows: maps, staleIds: brokenIds, coverage, approvedCount } = registry;

  const stateLabel: { label: string; tone: StatusColor } = !portal
    ? { label: "Not registered", tone: "neutral" }
    : portal.provenAt
      ? { label: "Proven", tone: "green" }
      : approvedCount > 0
        ? { label: "Trained", tone: "blue" }
        : maps.length > 0
          ? { label: "Captured", tone: "amber" }
          : { label: "Registered · no fields", tone: "amber" };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border border-[#E8E5E0] bg-muted/20">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
          >
            <span className="flex items-center gap-2 text-xs font-medium">
              Form setup
              <StatusPill status={stateLabel.tone} label={stateLabel.label} />
              {brokenIds.size > 0 ? (
                <StatusPill status="red" label={`${brokenIds.size} broken`} />
              ) : null}
              {coverage.needsDecision > 0 && brokenIds.size === 0 ? (
                <StatusPill status="amber" label={`${coverage.needsDecision} to decide`} />
              ) : null}
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 border-t border-[#E8E5E0] px-3 py-3">
            {!portalKey ? (
              <p className="text-[12px] text-muted-foreground">
                Pick a portal above, or register a new one to link this step.
              </p>
            ) : !portal ? (
              <p className="text-[12px] text-[#92400E]">
                No registered portal matches <code>{portalKey}</code> — register it below.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">{portalDisplayName(portal)}</span>
                {portal.orgId === null ? <StatusPill status="brand" label="Global" /> : null}
                {portal.formUrl ? (
                  <a
                    href={portal.formUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    Open portal in a new tab (does not capture)
                  </a>
                ) : (
                  <span>No form URL</span>
                )}
                {canEdit ? (
                  <button
                    type="button"
                    className="font-medium text-[#1B4D3E] underline underline-offset-2"
                    onClick={() => setDrawerOpen(true)}
                  >
                    Edit URL
                  </button>
                ) : null}
                {/* Informational only — no readiness semantics (D13). */}
                <span>
                  {coverage.mapped} of {coverage.total} mapped overall
                  {coverage.pages > 0
                    ? ` · ${coverage.pages} page${coverage.pages === 1 ? "" : "s"} captured`
                    : ""}
                  {coverage.needsDecision > 0 ? ` · ${coverage.needsDecision} to decide` : ""}
                </span>
              </div>
            )}

            {canEdit && (!portal || !portalKey) ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setRegisterOpen(true)}
              >
                Register {isGlobalAuthoring ? "global " : ""}portal
              </Button>
            ) : null}

            {portal ? <PortalFieldRegistry editor={registry} canEdit={canEdit} /> : null}

            {portal ? (
              <WorkbenchHandoffBlock
                formUrl={portal.formUrl}
                mode={portal.provenAt ? "maintain" : maps.length === 0 ? "capture" : "prove"}
                onCopyReturnLink={() => void copyReturnLink()}
              />
            ) : null}
          </div>
        </CollapsibleContent>
      </div>

      {registerOpen ? (
        <RegisterPortalDialog
          isGlobalAuthoring={isGlobalAuthoring}
          templatePayerId={templatePayerId}
          initialKey={portalKey ?? ""}
          onClose={() => setRegisterOpen(false)}
          onRegistered={(key) => {
            setRegisterOpen(false);
            onPortalKeyChange?.(key);
          }}
        />
      ) : null}

      {drawerOpen && portal ? (
        <PortalDrawer
          portal={portal}
          payerId={templatePayerId ?? portal.payerId ?? ""}
          onClose={() => setDrawerOpen(false)}
          onPortalUpdated={() => {
            void qc.invalidateQueries({ queryKey: queryKeys.portals(orgId) });
          }}
        />
      ) : null}
    </Collapsible>
  );
}

function WorkbenchHandoffBlock({
  formUrl,
  mode,
  onCopyReturnLink,
}: {
  formUrl: string | null;
  mode: "capture" | "prove" | "maintain";
  onCopyReturnLink: () => void;
}) {
  const title =
    mode === "capture"
      ? "Finish capture in Minted Workbench"
      : mode === "prove"
        ? "Prove this form in Minted Workbench"
        : "Finish this in Minted Workbench";
  return (
    <div className="space-y-2 rounded-md border border-[#E8E5E0] bg-[#FAFAF9] px-3 py-3">
      <p className="text-[12px] font-semibold text-foreground">{title}</p>
      <p className="text-[12px] text-muted-foreground">
        Minted Panel does not submit payer portal forms and cannot read the live page. Capture and
        prove run in the Workbench Chrome extension.
      </p>
      <ol className="list-decimal space-y-0.5 pl-4 text-[12px] text-muted-foreground">
        <li>Open the form page</li>
        <li>Open the Workbench side panel</li>
        <li>Capture fields (Send for approval)</li>
        <li>Run the mock dry run — no real PHI, nothing submitted</li>
        <li>Mark proven</li>
      </ol>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {formUrl ? (
          <a
            href={formUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
          >
            Open portal in a new tab (does not capture)
          </a>
        ) : null}
        <button
          type="button"
          onClick={onCopyReturnLink}
          className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
        >
          Copy return link to this step
        </button>
      </div>
    </div>
  );
}

function RegisterPortalDialog({
  isGlobalAuthoring,
  templatePayerId,
  initialKey,
  onClose,
  onRegistered,
}: {
  isGlobalAuthoring: boolean;
  templatePayerId: string | null;
  initialKey: string;
  onClose: () => void;
  onRegistered: (portalKey: string) => void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState(initialKey);
  const [formUrl, setFormUrl] = useState("");
  const upsertGlobalMut = useUpsertGlobalPortal();
  const createOrgMut = useCreatePortal();
  const busy = upsertGlobalMut.isPending || createOrgMut.isPending;

  async function register() {
    const normalized = normalizePortalKey(key);
    if (!name.trim() || !normalized) {
      toast.error("Portal name and key are required");
      return;
    }
    try {
      if (isGlobalAuthoring) {
        await upsertGlobalMut.mutateAsync({
          name,
          portalKey: normalized,
          payerId: templatePayerId,
          formUrl: formUrl.trim() || null,
        });
      } else {
        await createOrgMut.mutateAsync({
          name,
          portalKey: normalized,
          payerId: templatePayerId,
          formUrl: formUrl.trim() || null,
        });
      }
      toast.success(`Portal registered${isGlobalAuthoring ? " globally" : ""}`);
      onRegistered(normalized);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not register the portal");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Register {isGlobalAuthoring ? "global " : ""}portal</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isGlobalAuthoring ? (
            <p className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#92400E]">
              Registered once, inherited by every organization.
            </p>
          ) : null}
          <div>
            <Label className="text-xs">Portal name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="BCBS KS enrollment"
            />
          </div>
          <div>
            <Label className="text-xs">Portal key</Label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="bcbs_ks_enrollment"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Lowercased on save; immutable after — it joins SOP steps, field maps, and fill logs.
            </p>
          </div>
          <div>
            <Label className="text-xs">Form URL (optional)</Label>
            <Input
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void register()}
            disabled={busy}
            style={{ backgroundColor: "#1B4D3E" }}
            className="text-white hover:opacity-90"
          >
            {busy ? "Registering…" : "Register"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
