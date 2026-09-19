import {
  isValidHandoffUrl,
  sendSetActiveCase,
  type ExtensionHandoffResult,
  type SetActiveCaseInput,
} from "@/lib/extensionHandoff";

export interface PortalLaunchDependencies {
  send: (input: SetActiveCaseInput) => Promise<ExtensionHandoffResult>;
  open: (url: string, target: string, features: string) => unknown;
}

export interface PortalLaunchStart {
  // A request is truthful even when the browser returns null for an isolated
  // noopener tab. The UI retains a direct link for blocking/recovery.
  portalStatus: "requested" | "failed";
  receipt: Promise<ExtensionHandoffResult>;
}

/** Preserve the original click gesture: initiate extension messaging, then
 * request one isolated portal tab synchronously, before any receipt await. */
export function beginPortalLaunch(
  input: SetActiveCaseInput,
  dependencies: Partial<PortalLaunchDependencies> = {},
): PortalLaunchStart {
  const send = dependencies.send ?? sendSetActiveCase;
  const open =
    dependencies.open ??
    ((url: string, target: string, features: string) => window.open(url, target, features));

  const receipt = send({ ...input });
  // Keep navigation on the same HTTPS boundary as the wire message. Invalid
  // identifiers may still open a valid portal for manual recovery; unsafe URLs
  // must not.
  if (!isValidHandoffUrl(input.portalUrl)) {
    return { portalStatus: "failed", receipt };
  }
  try {
    open(input.portalUrl, "_blank", "noopener,noreferrer");
    return { portalStatus: "requested", receipt };
  } catch {
    return { portalStatus: "failed", receipt };
  }
}

export interface PortalLaunchGuard {
  begin: () => number;
  isCurrent: (generation: number) => boolean;
  invalidate: () => void;
}

export interface PortalLaunchContextKeyInput {
  authUserId: string | null;
  authSessionExpiresAt: number | null;
  activeOrgId: string | null;
  orgId: string;
  caseId: string;
  providerId: string;
  portalKey: string;
  portalUrl: string;
  facilityId: string | undefined;
}

/** A local, non-wire identity for invalidating pending UI receipts. Session
 * expiry is included with the user ID so same-org account and session changes
 * cannot reuse an older launch generation. */
export function createPortalLaunchContextKey(input: PortalLaunchContextKeyInput): string {
  return JSON.stringify([
    input.authUserId ?? "signed-out",
    input.authSessionExpiresAt ?? "no-session",
    input.activeOrgId ?? "no-org",
    input.orgId,
    input.caseId,
    input.providerId,
    input.portalKey,
    input.portalUrl,
    input.facilityId ?? "no-facility",
  ]);
}

/** Local completion ordering for the UI. This does not alter the locked wire
 * contract; it only prevents an old promise from updating a newer/unmounted
 * button state. */
export function createPortalLaunchGuard(): PortalLaunchGuard {
  let current = 0;
  return {
    begin: () => {
      current += 1;
      return current;
    },
    isCurrent: (generation) => generation === current,
    invalidate: () => {
      current += 1;
    },
  };
}
