// Platform → extension case handoff. The web app addresses one configured
// installation, sends identifiers + an HTTPS portal URL only, and treats the
// extension's reply as a receipt. Authentication, authorization, application,
// side-panel visibility, and portal navigation are separate outcomes.

import {
  parseWorkContextValidationRequest,
  workContextTuple,
  type WorkContextTuple,
  type WorkContextValidationRequest,
} from "@/lib/workContext";

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
  | { status: "ready"; tabId: number }
  | {
      status: "unavailable";
      reason: "missing_configuration" | "invalid_configuration" | "messaging_unavailable";
    }
  | { status: "update_required" }
  | { status: "rejected" }
  | { status: "invalid"; reason: "invalid_context" | "malformed_response" }
  | { status: "failed" }
  | { status: "timeout" };

export const HANDOFF_RECEIPT_TIMEOUT_MS = 2_000;
export const WORK_HANDOFF_RECEIPT_TIMEOUT_MS = 7_000;

export type SetActiveWorkInput = WorkContextTuple & {
  /** Untrusted launch hint. Extension must compare it with the validator's
   * server-canonical formUrl and navigate only to that returned URL. */
  portalUrl: string;
};

export type SetActiveWorkMessage = WorkContextValidationRequest & {
  type: "SET_ACTIVE_WORK";
  portalUrl: string;
};

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

export function normalizeHandoffUrl(value: string): string | null {
  if (!isValidHandoffUrl(value)) return null;
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

/** Build a strict v2 message. The URL is a cross-check hint for Extension;
 * the validation POST body is always URL-free. */
export function buildSetActiveWorkMessage(input: SetActiveWorkInput): SetActiveWorkMessage | null {
  const portalUrl = normalizeHandoffUrl(input.portalUrl);
  if (!portalUrl) return null;
  const { portalUrl: _portalUrl, ...tuple } = input;
  const request: WorkContextValidationRequest = { protocolVersion: 2, ...tuple };
  const parsed = parseWorkContextValidationRequest(request);
  if (!parsed.ok) return null;
  return { type: "SET_ACTIVE_WORK", ...parsed.request, portalUrl };
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

function exactTupleEqual(value: unknown, expected: WorkContextTuple): boolean {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = value as Record<string, unknown>;
  const keys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  return (
    keys.length === actualKeys.length &&
    keys.every(
      (key, index) =>
        key === actualKeys[index] && actual[key] === expected[key as keyof WorkContextTuple],
    )
  );
}

function workReceiptResult(
  response: unknown,
  message: SetActiveWorkMessage,
): ExtensionHandoffResult {
  if (response == null || typeof response !== "object" || Array.isArray(response)) {
    return { status: "invalid", reason: "malformed_response" };
  }
  const row = response as Record<string, unknown>;
  if (row.ok === false) {
    if (row.code === "UPDATE_REQUIRED") return { status: "update_required" };
    if (row.code === "STALE_CONTEXT") return { status: "invalid", reason: "invalid_context" };
    return { status: "rejected" };
  }
  const { type: _type, portalUrl: _portalUrl, ...request } = message;
  const expectedTuple = workContextTuple(request);
  if (
    row.ok !== true ||
    row.protocolVersion !== 2 ||
    row.capability !== "exact-work-tab-v2" ||
    row.launchReceiptId !== message.launchReceiptId ||
    !exactTupleEqual(row.tuple, expectedTuple) ||
    normalizeHandoffUrl(String(row.portalUrl ?? "")) !== normalizeHandoffUrl(message.portalUrl) ||
    !Number.isSafeInteger(row.tabId) ||
    typeof row.tabId !== "number" ||
    row.tabId < 1
  ) {
    return { status: "invalid", reason: "malformed_response" };
  }
  return { status: "ready", tabId: row.tabId };
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

/** Send a versioned work context and accept only a receipt proving that the
 * exact tuple is attached to the Extension-created portal tab. This path has
 * no navigation or SET_ACTIVE_CASE fallback. */
export function sendSetActiveWork(input: SetActiveWorkInput): Promise<ExtensionHandoffResult> {
  const message = buildSetActiveWorkMessage(input);
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
    const timer = setTimeout(() => finish({ status: "timeout" }), WORK_HANDOFF_RECEIPT_TIMEOUT_MS);

    try {
      sendMessage.call(runtime, config.extensionId, message, (response) => {
        if (runtime?.lastError) {
          finish({ status: "failed" });
          return;
        }
        finish(workReceiptResult(response, message));
      });
    } catch {
      finish({ status: "failed" });
    }
  });
}
