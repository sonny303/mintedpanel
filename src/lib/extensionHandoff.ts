// Platform → extension case handoff. The web app addresses one configured
// installation, sends identifiers + an HTTPS portal URL only, and treats the
// extension's reply as a receipt. Authentication, authorization, application,
// side-panel visibility, and portal navigation are separate outcomes.

export interface SetActiveCaseMessage {
  type: "SET_ACTIVE_CASE";
  caseId: string;
  providerId: string;
  orgId: string;
  portalUrl: string;
  portalKey?: string;
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

export type ExtensionHandoffResult =
  | { status: "received" }
  | {
      status: "unavailable";
      reason: "missing_configuration" | "invalid_configuration" | "messaging_unavailable";
    }
  | { status: "rejected" }
  | { status: "invalid"; reason: "invalid_context" | "malformed_response" }
  | { status: "failed" }
  | { status: "timeout" };

export const HANDOFF_RECEIPT_TIMEOUT_MS = 2_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHROME_EXTENSION_ID_RE = /^[a-p]{32}$/;

/** Strict URL boundary shared by the sender and mounted registry target. */
export function isValidHandoffUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.length > 0 &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

/** Build the locked wire shape. Invalid required context rejects the launch;
 * malformed optional fields are omitted so the base-case receipt remains
 * compatible with older senders and receivers. */
export function buildSetActiveCaseMessage(input: SetActiveCaseInput): SetActiveCaseMessage | null {
  if (!UUID_RE.test(input.caseId)) return null;
  if (!UUID_RE.test(input.providerId)) return null;
  if (!UUID_RE.test(input.orgId)) return null;
  if (!isValidHandoffUrl(input.portalUrl)) return null;

  const message: SetActiveCaseMessage = {
    type: "SET_ACTIVE_CASE",
    caseId: input.caseId,
    providerId: input.providerId,
    orgId: input.orgId,
    portalUrl: input.portalUrl,
  };
  const portalKey = input.portalKey?.trim().toLowerCase();
  if (portalKey) message.portalKey = portalKey;
  if (input.facilityId && UUID_RE.test(input.facilityId)) {
    message.facilityId = input.facilityId;
  }
  return message;
}

interface ChromeRuntimeLike {
  runtime?: {
    lastError?: { message?: string };
    sendMessage?: (
      extensionId: string,
      message: unknown,
      callback: (response: unknown) => void,
    ) => void;
  };
}

function chromeRuntime(): ChromeRuntimeLike["runtime"] {
  if (typeof globalThis === "undefined") return undefined;
  return (globalThis as { chrome?: ChromeRuntimeLike }).chrome?.runtime;
}

export function isExtensionMessagingAvailable(): boolean {
  return typeof chromeRuntime()?.sendMessage === "function";
}

function extensionConfiguration():
  { status: "valid"; extensionId: string } | { status: "missing" } | { status: "invalid" } {
  const raw = import.meta.env.VITE_MINTED_EXTENSION_ID;
  if (typeof raw !== "string" || raw === "") return { status: "missing" };
  if (!CHROME_EXTENSION_ID_RE.test(raw)) return { status: "invalid" };
  return { status: "valid", extensionId: raw };
}

function receiptResult(response: unknown): ExtensionHandoffResult {
  if (response == null || typeof response !== "object") {
    return { status: "invalid", reason: "malformed_response" };
  }
  const ok = (response as Record<string, unknown>).ok;
  if (ok === true) return { status: "received" };
  if (ok === false) return { status: "rejected" };
  return { status: "invalid", reason: "malformed_response" };
}

/** Start the addressed send synchronously and settle with one bounded receipt.
 * Callback runtime errors and synchronous exceptions stay generic because
 * transport errors do not prove whether an extension is installed. */
export function sendSetActiveCase(input: SetActiveCaseInput): Promise<ExtensionHandoffResult> {
  const message = buildSetActiveCaseMessage(input);
  if (message == null) {
    return Promise.resolve({ status: "invalid", reason: "invalid_context" });
  }

  const config = extensionConfiguration();
  if (config.status === "missing") {
    return Promise.resolve({ status: "unavailable", reason: "missing_configuration" });
  }
  if (config.status === "invalid") {
    return Promise.resolve({ status: "unavailable", reason: "invalid_configuration" });
  }

  const runtime = chromeRuntime();
  const sendMessage = runtime?.sendMessage;
  if (typeof sendMessage !== "function") {
    return Promise.resolve({ status: "unavailable", reason: "messaging_unavailable" });
  }

  return new Promise<ExtensionHandoffResult>((resolve) => {
    let settled = false;
    const finish = (result: ExtensionHandoffResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "timeout" }), HANDOFF_RECEIPT_TIMEOUT_MS);

    try {
      // Callback form works before Chrome 118 and still starts synchronously.
      // Reading lastError inside this callback is required by the Chrome API.
      sendMessage.call(runtime, config.extensionId, message, (response) => {
        if (runtime?.lastError) {
          finish({ status: "failed" });
          return;
        }
        finish(receiptResult(response));
      });
    } catch {
      finish({ status: "failed" });
    }
  });
}
