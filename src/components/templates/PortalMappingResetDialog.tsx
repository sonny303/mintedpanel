import type { Portal } from "@/types";
import type { PortalStepReference } from "@/lib/portalRetirement";
import { portalDisplayName } from "@/lib/portalRetirement";
import { portalMappingResetImpactText } from "@/lib/portalMappingReset";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PortalMappingResetDialogProps {
  open: boolean;
  portal: Portal | null;
  fieldCount?: number;
  fieldCountLoading: boolean;
  fieldCountError: boolean;
  references: readonly PortalStepReference[];
  referencesLoading: boolean;
  referencesError: boolean;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onOpenChange: (open: boolean) => void;
}

export function PortalMappingResetDialog({
  open,
  portal,
  fieldCount,
  fieldCountLoading,
  fieldCountError,
  references,
  referencesLoading,
  referencesError,
  pending,
  error,
  onConfirm,
  onCancel,
  onOpenChange,
}: PortalMappingResetDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && portal ? (
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reset form mapping?</DialogTitle>
            <DialogDescription>
              Confirm the exact configuration and impact before starting a fresh mapping generation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-[12px]">
            <div className="rounded-md border border-[#E8E5E0] p-3">
              <p className="font-medium text-foreground">
                {portalDisplayName(portal)} · {portal.caseType ?? "Unclassified"}
              </p>
              <p className="mt-1 text-muted-foreground">
                {portal.orgId === null
                  ? "Global/shared configuration · affects every organization using this exact portal key"
                  : "Organization configuration · affects only this organization"}
              </p>
              <p className="mt-1 text-muted-foreground">
                Current generation {portal.mappingGeneration ?? 1} ·{" "}
                {fieldCountLoading
                  ? "Counting saved fields…"
                  : fieldCountError
                    ? "Could not count current saved fields"
                    : `${fieldCount ?? 0} saved field rows in this generation`}
              </p>
            </div>

            <p className="rounded-md border border-border bg-[var(--mp-warn-tint)] p-3 text-[var(--mp-warn-ink)]">
              {portalMappingResetImpactText(portal)}
            </p>

            <p className="text-muted-foreground">
              Saved mappings become inactive; proof and verification are cleared. Historical records
              and SOP links stay in place. This does not change values on a payer page or submit its
              form. Recapture and review this mapping before filling again.
            </p>

            <section aria-label="Visible SOP references" className="space-y-1">
              <h3 className="font-medium text-foreground">
                SOP references visible to this organization
              </h3>
              {referencesLoading ? (
                <p className="text-muted-foreground">Loading authorized SOP references…</p>
              ) : referencesError ? (
                <p className="text-muted-foreground">
                  Could not load authorized SOP references. Refresh before confirming this reset.
                </p>
              ) : references.length === 0 ? (
                <p className="text-muted-foreground">
                  No matching references are visible in this organization’s authorized SOP list.
                </p>
              ) : (
                <ul className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-[#E8E5E0] p-2">
                  {references.map((reference) => (
                    <li
                      key={`${reference.templateId}:${reference.taskIndex}:${reference.stepIndex}`}
                      className="text-muted-foreground"
                    >
                      <span className="font-medium text-foreground">{reference.templateName}</span>
                      {` · ${reference.taskLabel} / ${reference.stepLabel} · ${reference.templateTier === "global" ? "Shared SOP" : "Organization SOP"}`}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {error ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 p-2 text-destructive"
              >
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                pending ||
                fieldCountLoading ||
                fieldCountError ||
                referencesLoading ||
                referencesError
              }
              onClick={onConfirm}
            >
              {pending ? "Resetting…" : "Reset form mapping"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
