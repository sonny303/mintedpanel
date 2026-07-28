// E4.3 F4.3.1 / TE-1 — the platform→extension case handoff. When the user
// launches "Work in portal" from a case, the app hands the exact case context
// to the Minted Panel Workbench extension so its side panel opens on that same
// case, then opens the portal tab regardless of whether the extension is there.
//
// The message carries IDENTIFIERS + URL ONLY — never any profile or token
// value (those flow through the audited /api/providers/:id/profile endpoint,
// never through a Chrome message). This is the locked TE-1 shape; keep it in
// lockstep with the extension's `externally_connectable` handler (the message
// contract is panel-first, mirrored in sonny303/minted-extension).
//
// Feature detection is defensive: `chrome.runtime.sendMessage` exists only when
// the extension is installed AND the page's origin is in its
// externally_connectable allowlist. When it is absent, the portal tab still
// opens and the caller shows a one-line non-blocking notice — the degraded
// path is first-class UX, never an error (F4.3.1).

/** The SET_ACTIVE_CASE message. Identifiers + portal URL only.
 *
 * S3.5 widened it ADDITIVELY with `portalKey` and `facilityId` (doc 06 C1's
 * {org, provider, location, case, portal_key}). Both are optional: the
 * extension strict-parses and drops unknowns, so an older extension ignores
 * them and a newer one degrades when a case carries neither. Still
 * identifiers + URL ONLY — no profile or token value has ever ridden this
 * channel and none does now. */
export interface SetActiveCaseMessage {
  type: "SET_ACTIVE_CASE";
  caseId: string;
  providerId: string;
  orgId: string;
  portalUrl: string;
  // The registry key of the portal being launched — lets the panel bind the
  // right portal without re-deriving it from the URL.
  portalKey?: string;
  // The case's location, when it has one: the facility.* / assignment.*
  // tokens resolve from it, so passing it here saves the user a picker.
  facilityId?: string;
}

export interface SetActiveCaseInput {
  caseId: string;
  providerId: string;
  orgId: string;
  portalUrl: string;
  portalKey?: string | null;
  facilityId?: string | null;
}

/** Build the message from the case context. Pure — no side effects, so it is
 * unit-testable without a Chrome environment. Optional fields are OMITTED when
 * absent rather than sent as null, so the wire shape stays minimal and the
 * extension's strict parser sees exactly what it can use. */
export function buildSetActiveCaseMessage(input: SetActiveCaseInput): SetActiveCaseMessage {
  const message: SetActiveCaseMessage = {
    type: "SET_ACTIVE_CASE",
    caseId: input.caseId,
    providerId: input.providerId,
    orgId: input.orgId,
    portalUrl: input.portalUrl,
  };
  if (input.portalKey) message.portalKey = input.portalKey;
  if (input.facilityId) message.facilityId = input.facilityId;
  return message;
}

// The minimal shape of `chrome.runtime.sendMessage` we depend on, so this file
// needs no @types/chrome dependency and stays a no-op off-extension.
interface ChromeRuntimeLike {
  runtime?: { sendMessage?: (message: unknown) => unknown };
}

/** Is the extension's external messaging surface present on this page? True
 * only when the extension is installed and this origin is allowlisted. */
export function isExtensionMessagingAvailable(): boolean {
  if (typeof globalThis === "undefined") return false;
  const chrome = (globalThis as { chrome?: ChromeRuntimeLike }).chrome;
  return typeof chrome?.runtime?.sendMessage === "function";
}

/** Best-effort hand the case context to the extension. Returns whether the
 * message was attempted (i.e. the extension surface was present). NEVER throws
 * — a messaging failure must not block opening the portal tab. */
export function sendSetActiveCase(input: SetActiveCaseInput): boolean {
  if (!isExtensionMessagingAvailable()) return false;
  try {
    const chrome = (globalThis as { chrome?: ChromeRuntimeLike }).chrome;
    chrome?.runtime?.sendMessage?.(buildSetActiveCaseMessage(input));
    return true;
  } catch {
    // A disconnected port / uninstalled-mid-session error must not surface —
    // the portal still opens and the notice covers the extension-absent path.
    return false;
  }
}
