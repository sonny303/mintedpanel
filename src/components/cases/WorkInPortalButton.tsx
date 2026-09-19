import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveOrgId, useAuthStore } from "@/lib/auth-store";
import type { ExtensionHandoffResult } from "@/lib/extensionHandoff";
import type { CasePortalTarget } from "@/lib/casePortals";
import {
  beginPortalLaunch,
  createPortalLaunchContextKey,
  createPortalLaunchGuard,
} from "@/lib/portalLaunch";

type PortalStatus = "idle" | "requested" | "failed";
type ReceiptStatus = { status: "idle" } | { status: "pending" } | ExtensionHandoffResult;
interface LaunchUiState {
  contextKey: string;
  portalStatus: PortalStatus;
  receipt: ReceiptStatus;
}

function receiptMessage(receipt: ReceiptStatus): string | null {
  if (receipt.status === "idle") return null;
  if (receipt.status === "pending") return "Waiting for the extension receipt…";
  if (receipt.status === "received") {
    return "Extension received the case. Sign-in and access are checked there.";
  }
  if (receipt.status === "rejected") {
    return "Extension rejected the handoff. Open it and use case search.";
  }
  if (receipt.status === "timeout") {
    return "Extension receipt timed out. Open it and use case search.";
  }
  if (receipt.status === "failed") {
    return "Extension handoff failed. Open it and use case search.";
  }
  if (receipt.reason === "missing_configuration") {
    return "Extension handoff is not configured for this web environment.";
  }
  if (receipt.reason === "invalid_configuration") {
    return "This web environment has an invalid extension handoff configuration.";
  }
  if (receipt.reason === "messaging_unavailable") {
    return "Extension messaging is unavailable in this browser. Open it and use case search.";
  }
  if (receipt.reason === "invalid_context") {
    return "The case context is invalid, so it was not sent to the extension.";
  }
  return "Extension returned an unreadable receipt. Open it and use case search.";
}

export function WorkInPortalButton({
  caseId,
  providerId,
  orgId,
  target,
  facilityId,
  disabled = false,
  disabledReason,
}: {
  caseId: string;
  providerId: string;
  orgId: string;
  target: CasePortalTarget;
  facilityId?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const activeOrgId = useActiveOrgId();
  const authUserId = useAuthStore((state) => state.session?.user.id ?? null);
  const authSessionExpiresAt = useAuthStore((state) => state.session?.expires_at ?? null);
  const guardRef = useRef(createPortalLaunchGuard());
  const [launchState, setLaunchState] = useState<LaunchUiState | null>(null);
  const contextKey = createPortalLaunchContextKey({
    authUserId,
    authSessionExpiresAt,
    activeOrgId,
    orgId,
    caseId,
    providerId,
    portalKey: target.portalKey,
    portalUrl: target.url,
    facilityId,
  });

  // State is tagged with the click's exact auth/org/case context. A React
  // render can observe an account or session change before passive effects
  // run, so stale receipt text must be excluded during render itself.
  const visibleLaunchState = launchState?.contextKey === contextKey ? launchState : null;
  const portalStatus = visibleLaunchState?.portalStatus ?? "idle";
  const receipt = visibleLaunchState?.receipt ?? { status: "idle" as const };

  useEffect(() => {
    const guard = guardRef.current;
    return () => guard.invalidate();
  }, []);

  const activeOrgMatches = authUserId !== null && activeOrgId === orgId;
  const launchDisabled = disabled || !activeOrgMatches;
  const launchDisabledReason =
    disabledReason ??
    (!authUserId || !activeOrgId
      ? "Sign in before sending case context to the extension."
      : !activeOrgMatches
        ? "Open this case in the active organization before sending it."
        : undefined);

  const launch = () => {
    if (launchDisabled) return;

    const snapshot = {
      caseId,
      providerId,
      orgId,
      portalUrl: target.url,
      portalKey: target.portalKey,
      facilityId,
    };
    const launchContextKey = contextKey;
    const generation = guardRef.current.begin();
    setLaunchState({
      contextKey: launchContextKey,
      portalStatus: "idle",
      receipt: { status: "pending" },
    });

    // Both calls happen inside this original click. beginPortalLaunch starts
    // messaging, then requests one portal tab before any receipt await.
    const started = beginPortalLaunch(snapshot);
    setLaunchState((current) =>
      current?.contextKey === launchContextKey
        ? { ...current, portalStatus: started.portalStatus }
        : current,
    );
    void started.receipt.then((result) => {
      if (!guardRef.current.isCurrent(generation)) return;
      setLaunchState((current) =>
        current?.contextKey === launchContextKey ? { ...current, receipt: result } : current,
      );
    });
  };

  const receiptText = receiptMessage(receipt);

  return (
    <div className="basis-full space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[12px] shadow-none"
          onClick={launch}
          disabled={launchDisabled}
          title={launchDisabledReason ?? `Send this case to ${target.name} workbench`}
        >
          Work in portal
          <ExternalLink className="ml-1.5 h-3 w-3" aria-hidden />
        </Button>
        <a
          href={target.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[#1B4D3E] underline-offset-2 hover:underline"
        >
          Open portal directly
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
      {launchDisabledReason ? (
        <p className="text-[11px] text-muted-foreground">{launchDisabledReason}</p>
      ) : null}
      {portalStatus === "requested" ? (
        <p className="text-[11px] text-muted-foreground">
          Portal tab requested. If the browser blocked it, use Open portal directly.
        </p>
      ) : portalStatus === "failed" ? (
        <p className="text-[11px] text-muted-foreground">
          Portal tab could not be requested. Use Open portal directly.
        </p>
      ) : null}
      {receiptText ? (
        <p role="status" aria-live="polite" className="text-[11px] text-muted-foreground">
          {receiptText}
        </p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Manual recovery: open the extension and use case search.
      </p>
    </div>
  );
}
