import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveOrgId, useAuthStore } from "@/lib/auth-store";
import {
  beginWorkPortalLaunch,
  createPortalLaunchGuard,
  type WorkPortalLaunchStart,
} from "@/lib/portalLaunch";
import type { ExtensionHandoffResult } from "@/lib/extensionHandoff";
import type { WorkContextLaunchTuple } from "@/lib/workContext";

type WorkReceiptState =
  | { status: "idle" }
  | { status: "pending"; contextKey: string }
  | (ExtensionHandoffResult & { contextKey: string });

function receiptMessage(receipt: WorkReceiptState): string | null {
  if (receipt.status === "idle") return null;
  if (receipt.status === "pending") return "Waiting for exact work-tab validation…";
  if (receipt.status === "ready")
    return "The extension validated this step and opened its exact work tab.";
  if (receipt.status === "update_required")
    return "Update the extension before starting this exact work step.";
  if (receipt.status === "timeout")
    return "No exact work-tab acknowledgement arrived. Refresh this step before retrying.";
  if (receipt.status === "rejected")
    return "The extension did not accept this work context. Refresh and review the step configuration.";
  if (receipt.status === "invalid")
    return "The exact work context or acknowledgement was invalid; no work tab was confirmed.";
  if (receipt.status === "unavailable")
    return "The versioned extension handoff is unavailable in this browser.";
  return "The extension handoff failed before it could confirm the exact work tab.";
}

/** MINT-56 exact-tab launch. This path never opens a Panel-owned tab and has
 * no legacy SET_ACTIVE_CASE fallback. */
export function WorkInPortalV2Button({
  tuple,
  portalUrl,
  portalName,
  disabled = false,
  disabledReason,
}: {
  tuple: WorkContextLaunchTuple;
  portalUrl: string;
  portalName: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const activeOrgId = useActiveOrgId();
  const authUserId = useAuthStore((state) => state.session?.user.id ?? null);
  const authSessionExpiresAt = useAuthStore((state) => state.session?.expires_at ?? null);
  const guardRef = useRef(createPortalLaunchGuard());
  const [receipt, setReceipt] = useState<WorkReceiptState>({ status: "idle" });
  const contextKey = JSON.stringify([
    authUserId,
    authSessionExpiresAt,
    activeOrgId,
    tuple,
    portalUrl,
  ]);
  const currentContextKey = useRef(contextKey);
  const previousContextKey = useRef(contextKey);
  currentContextKey.current = contextKey;
  const visibleReceipt =
    receipt.status === "idle" || receipt.contextKey === contextKey
      ? receipt
      : ({ status: "idle" } as const);

  useEffect(() => () => guardRef.current.invalidate(), []);
  useEffect(() => {
    if (previousContextKey.current === contextKey) return;
    previousContextKey.current = contextKey;
    guardRef.current.invalidate();
    setReceipt({ status: "idle" });
  }, [contextKey]);

  const activeOrgMatches = Boolean(authUserId && activeOrgId === tuple.orgId);
  const launchDisabled = disabled || !activeOrgMatches;
  const launchDisabledReason =
    disabledReason ??
    (!authUserId || !activeOrgId
      ? "Sign in before sending this work step to the extension."
      : !activeOrgMatches
        ? "Open this work step in the active organization before sending it."
        : undefined);

  const launch = () => {
    if (launchDisabled || !globalThis.crypto?.randomUUID) return;
    const launchContextKey = contextKey;
    const generation = guardRef.current.begin();
    setReceipt({ status: "pending", contextKey: launchContextKey });
    const started: WorkPortalLaunchStart = beginWorkPortalLaunch({
      ...tuple,
      launchReceiptId: globalThis.crypto.randomUUID(),
      portalUrl,
    });
    void started.receipt.then((result) => {
      if (!guardRef.current.isCurrent(generation) || currentContextKey.current !== launchContextKey)
        return;
      setReceipt({ ...result, contextKey: launchContextKey });
    });
  };

  const receiptText = receiptMessage(visibleReceipt);
  return (
    <div className="basis-full space-y-1.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-[12px] shadow-none"
        onClick={launch}
        disabled={launchDisabled || !globalThis.crypto?.randomUUID}
        title={launchDisabledReason ?? `Send this exact step to ${portalName}`}
      >
        Work in portal
        <ExternalLink className="ml-1.5 h-3 w-3" aria-hidden />
      </Button>
      {launchDisabledReason ? (
        <p className="text-[11px] text-muted-foreground">{launchDisabledReason}</p>
      ) : null}
      {receiptText ? (
        <p role="status" aria-live="polite" className="text-[11px] text-muted-foreground">
          {receiptText}
        </p>
      ) : null}
    </div>
  );
}
