import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HANDOFF_RECEIPT_TIMEOUT_MS,
  buildSetActiveCaseMessage,
  isExtensionMessagingAvailable,
  sendSetActiveCase,
} from "./extensionHandoff";
import {
  HANDOFF_CASE_ID_FIXTURE,
  HANDOFF_EXTENSION_ID_FIXTURE,
  HANDOFF_FACILITY_ID_FIXTURE,
  HANDOFF_ORG_ID_FIXTURE,
  HANDOFF_PORTAL_URL_FIXTURE,
  HANDOFF_PROVIDER_ID_FIXTURE,
} from "@/testFixtures/extensionHandoff";
import {
  WORK_HANDOFF_RECEIPT_TIMEOUT_MS,
  buildSetActiveWorkMessage,
  sendSetActiveWork,
  type SetActiveWorkInput,
} from "./extensionHandoff";

const EXTENSION_ID = HANDOFF_EXTENSION_ID_FIXTURE;
const CASE_ID = HANDOFF_CASE_ID_FIXTURE;
const PROVIDER_ID = HANDOFF_PROVIDER_ID_FIXTURE;
const ORG_ID = HANDOFF_ORG_ID_FIXTURE;
const FACILITY_ID = HANDOFF_FACILITY_ID_FIXTURE;

const INPUT = {
  caseId: CASE_ID,
  providerId: PROVIDER_ID,
  orgId: ORG_ID,
  portalUrl: HANDOFF_PORTAL_URL_FIXTURE,
};

const WORK_INPUT: SetActiveWorkInput = {
  launchReceiptId: "b7a90000-0000-4000-a000-0000000000c1",
  orgId: ORG_ID,
  ownerKind: "case",
  ownerId: "b7a90000-0000-4000-a000-0000000000c2",
  contextVersion: 4,
  sopTemplateId: "b7a90000-0000-4000-a000-0000000000c3",
  sopVersion: 3,
  portalId: "b7a90000-0000-4000-a000-0000000000c4",
  portalKey: "regional_enrollment",
  mappingGeneration: 9,
  effectiveMappingFingerprint: "fingerprint-v2",
  providerId: PROVIDER_ID,
  facilityId: FACILITY_ID,
  stepIdentity:
    "b7a90000-0000-4000-a000-0000000000c2:b7a90000-0000-4000-a000-0000000000c5:b7a90000-0000-4000-a000-0000000000c3:3:step-one",
  taskId: "b7a90000-0000-4000-a000-0000000000c5",
  stepId: "b7a90000-0000-4000-a000-0000000000c6",
  portalUrl: HANDOFF_PORTAL_URL_FIXTURE,
};

function exactWorkAck(message: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const { type: _type, protocolVersion: _protocol, portalUrl, ...tuple } = message;
  return {
    ok: true,
    protocolVersion: 2,
    capability: "exact-work-tab-v2",
    launchReceiptId: WORK_INPUT.launchReceiptId,
    tuple,
    portalUrl,
    tabId: 42,
    ...overrides,
  };
}

function installSendMessage(sendMessage: (...args: unknown[]) => unknown) {
  const runtime = {
    sendMessage,
    lastError: undefined as { message?: string } | undefined,
  };
  (globalThis as { chrome?: unknown }).chrome = { runtime };
  return runtime;
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("buildSetActiveCaseMessage", () => {
  it("builds the exact identifiers-and-HTTPS-URL wire shape with real UUIDs", () => {
    expect(buildSetActiveCaseMessage(INPUT)).toEqual({
      type: "SET_ACTIVE_CASE",
      caseId: CASE_ID,
      providerId: PROVIDER_ID,
      orgId: ORG_ID,
      portalUrl: "https://portal.example/enroll",
    });
  });

  it("normalizes valid optional fields and preserves an explicit secondary facility", () => {
    const message = buildSetActiveCaseMessage({
      ...INPUT,
      portalKey: "  Regional_Enrollment ",
      facilityId: FACILITY_ID,
    });
    expect(message).toEqual({
      type: "SET_ACTIVE_CASE",
      caseId: CASE_ID,
      providerId: PROVIDER_ID,
      orgId: ORG_ID,
      portalUrl: "https://portal.example/enroll",
      portalKey: "regional_enrollment",
      facilityId: FACILITY_ID,
    });
  });

  it("omits absent or malformed optional fields for backward compatibility", () => {
    expect(
      buildSetActiveCaseMessage({
        ...INPUT,
        portalKey: "   ",
        facilityId: "not-a-uuid",
      }),
    ).toEqual({ type: "SET_ACTIVE_CASE", ...INPUT });
  });

  it("rejects malformed required identifiers and non-HTTPS portal URLs", () => {
    expect(buildSetActiveCaseMessage({ ...INPUT, caseId: "case-1" })).toBeNull();
    expect(buildSetActiveCaseMessage({ ...INPUT, providerId: "provider-1" })).toBeNull();
    expect(buildSetActiveCaseMessage({ ...INPUT, orgId: "org-1" })).toBeNull();
    expect(buildSetActiveCaseMessage({ ...INPUT, portalUrl: "http://portal.example" })).toBeNull();
    expect(buildSetActiveCaseMessage({ ...INPUT, portalUrl: "not a URL" })).toBeNull();
    expect(
      buildSetActiveCaseMessage({
        ...INPUT,
        portalUrl: "https://user:secret@portal.example/enroll",
      }),
    ).toBeNull();
  });
});

describe("extension messaging availability", () => {
  it("requires a runtime sendMessage function", () => {
    expect(isExtensionMessagingAvailable()).toBe(false);
    (globalThis as { chrome?: unknown }).chrome = { runtime: {} };
    expect(isExtensionMessagingAvailable()).toBe(false);
    installSendMessage((_extensionId, _message, callback) => {
      (callback as (response: unknown) => void)({ ok: true });
    });
    expect(isExtensionMessagingAvailable()).toBe(true);
  });
});

describe("sendSetActiveCase", () => {
  it("distinguishes missing and invalid public extension configuration", async () => {
    installSendMessage((_extensionId, _message, callback) => {
      (callback as (response: unknown) => void)({ ok: true });
    });
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", "");
    await expect(sendSetActiveCase(INPUT)).resolves.toEqual({
      status: "unavailable",
      reason: "missing_configuration",
    });

    vi.stubEnv("VITE_MINTED_EXTENSION_ID", "a".repeat(31));
    await expect(sendSetActiveCase(INPUT)).resolves.toEqual({
      status: "unavailable",
      reason: "invalid_configuration",
    });
  });

  it("reports missing browser messaging without calling it an installation diagnosis", async () => {
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);
    await expect(sendSetActiveCase(INPUT)).resolves.toEqual({
      status: "unavailable",
      reason: "messaging_unavailable",
    });
  });

  it("rejects invalid required context before sending", async () => {
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);
    const sendMessage = vi.fn((_extensionId, _message, callback) => {
      (callback as (response: unknown) => void)({ ok: true });
    });
    installSendMessage(sendMessage);
    await expect(sendSetActiveCase({ ...INPUT, caseId: "case-1" })).resolves.toEqual({
      status: "invalid",
      reason: "invalid_context",
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("initiates an addressed send synchronously with the exact message and accepts only {ok:true}", async () => {
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);
    const sendMessage = vi.fn((_extensionId, _message, callback) => {
      (callback as (response: unknown) => void)({ ok: true });
    });
    installSendMessage(sendMessage);

    const resultPromise = sendSetActiveCase({
      ...INPUT,
      portalKey: "regional_enrollment",
      facilityId: FACILITY_ID,
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      EXTENSION_ID,
      {
        type: "SET_ACTIVE_CASE",
        caseId: CASE_ID,
        providerId: PROVIDER_ID,
        orgId: ORG_ID,
        portalUrl: "https://portal.example/enroll",
        portalKey: "regional_enrollment",
        facilityId: FACILITY_ID,
      },
      expect.any(Function),
    );
    await expect(resultPromise).resolves.toEqual({ status: "received" });
  });

  it("maps {ok:false} to rejected and undefined or other replies to malformed", async () => {
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);

    installSendMessage((_extensionId, _message, callback) => {
      (callback as (response: unknown) => void)({ ok: false });
    });
    await expect(sendSetActiveCase(INPUT)).resolves.toEqual({ status: "rejected" });

    installSendMessage((_extensionId, _message, callback) => {
      (callback as (response: unknown) => void)(undefined);
    });
    await expect(sendSetActiveCase(INPUT)).resolves.toEqual({
      status: "invalid",
      reason: "malformed_response",
    });

    installSendMessage((_extensionId, _message, callback) => {
      (callback as (response: unknown) => void)({ ok: "true" });
    });
    await expect(sendSetActiveCase(INPUT)).resolves.toEqual({
      status: "invalid",
      reason: "malformed_response",
    });
  });

  it("maps synchronous throws and callback runtime.lastError to a generic transport failure", async () => {
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);

    installSendMessage(() => {
      throw new Error("Could not establish connection");
    });
    await expect(sendSetActiveCase(INPUT)).resolves.toEqual({ status: "failed" });

    const runtime = installSendMessage((_extensionId, _message, callback) => {
      queueMicrotask(() => {
        runtime.lastError = { message: "The message port closed" };
        (callback as (response: unknown) => void)(undefined);
        runtime.lastError = undefined;
      });
    });
    await expect(sendSetActiveCase(INPUT)).resolves.toEqual({ status: "failed" });
  });

  it("times out after the documented bound and ignores a late receipt", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);
    let resolveReply: (value: unknown) => void = () => undefined;
    installSendMessage((_extensionId, _message, callback) => {
      resolveReply = callback as (value: unknown) => void;
    });

    const resultPromise = sendSetActiveCase(INPUT);
    await vi.advanceTimersByTimeAsync(HANDOFF_RECEIPT_TIMEOUT_MS);
    await expect(resultPromise).resolves.toEqual({ status: "timeout" });

    resolveReply({ ok: true });
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toEqual({ status: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up the receipt timer after an early response", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);
    installSendMessage((_extensionId, _message, callback) => {
      (callback as (response: unknown) => void)({ ok: true });
    });
    await expect(sendSetActiveCase(INPUT)).resolves.toEqual({ status: "received" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles once when a legacy callback fires more than once", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);
    installSendMessage((_extensionId, _message, callback) => {
      const reply = callback as (response: unknown) => void;
      reply({ ok: true });
      reply({ ok: false });
    });

    const result = sendSetActiveCase(INPUT);
    await expect(result).resolves.toEqual({ status: "received" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("SET_ACTIVE_WORK exact tab bridge", () => {
  it("builds a strict v2 message with the URL as a hint and tuple-bound owner identity", () => {
    expect(buildSetActiveWorkMessage(WORK_INPUT)).toEqual({
      type: "SET_ACTIVE_WORK",
      protocolVersion: 2,
      ...(({ portalUrl: _portalUrl, ...tuple }) => tuple)(WORK_INPUT),
      portalUrl: "https://portal.example/enroll",
    });
    expect(
      buildSetActiveWorkMessage({ ...WORK_INPUT, portalUrl: "http://portal.example" }),
    ).toBeNull();
  });

  it("accepts only a capability acknowledgement for the exact tuple, receipt, URL and bound tab", async () => {
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);
    const sendMessage = vi.fn((_extensionId, message, callback) => {
      (callback as (response: unknown) => void)(exactWorkAck(message as Record<string, unknown>));
    });
    installSendMessage(sendMessage);

    await expect(sendSetActiveWork(WORK_INPUT)).resolves.toEqual({ status: "ready", tabId: 42 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toMatchObject({
      type: "SET_ACTIVE_WORK",
      protocolVersion: 2,
    });
  });

  it.each([
    ["wrong receipt", { launchReceiptId: "b7a90000-0000-4000-a000-0000000000c9" }],
    ["wrong tab binding", { tabId: 0 }],
    ["wrong capability", { capability: "case-context-v1" }],
    ["wrong tuple", { tuple: {} }],
    ["different server URL", { portalUrl: "https://other.example/form" }],
  ])("rejects ACKs with %s", async (_label, override) => {
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);
    installSendMessage((_extensionId, message, callback) => {
      (callback as (response: unknown) => void)(
        exactWorkAck(message as Record<string, unknown>, override),
      );
    });
    await expect(sendSetActiveWork(WORK_INPUT)).resolves.toMatchObject({ status: "invalid" });
  });

  it("rejects a generic {ok:true} receipt because it proves no exact tab binding", async () => {
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);
    installSendMessage((_extensionId, _message, callback) => {
      (callback as (response: unknown) => void)({ ok: true });
    });
    await expect(sendSetActiveWork(WORK_INPUT)).resolves.toEqual({
      status: "invalid",
      reason: "malformed_response",
    });
  });

  it("reports an explicit extension update requirement and has no legacy fallback", async () => {
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);
    const sendMessage = vi.fn((_extensionId, _message, callback) => {
      (callback as (response: unknown) => void)({ ok: false, code: "UPDATE_REQUIRED" });
    });
    installSendMessage(sendMessage);
    await expect(sendSetActiveWork(WORK_INPUT)).resolves.toEqual({ status: "update_required" });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toMatchObject({ type: "SET_ACTIVE_WORK" });
  });

  it("times out when the extension does not bind an exact tab", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_MINTED_EXTENSION_ID", EXTENSION_ID);
    installSendMessage(() => {});
    const result = sendSetActiveWork(WORK_INPUT);
    await vi.advanceTimersByTimeAsync(WORK_HANDOFF_RECEIPT_TIMEOUT_MS);
    await expect(result).resolves.toEqual({ status: "timeout" });
  });
});
