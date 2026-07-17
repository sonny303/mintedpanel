import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildSetActiveCaseMessage,
  isExtensionMessagingAvailable,
  sendSetActiveCase,
} from "./extensionHandoff";

const INPUT = {
  caseId: "case-1",
  providerId: "prov-1",
  orgId: "org-1",
  portalUrl: "https://portal.example/enroll",
};

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.restoreAllMocks();
});

describe("buildSetActiveCaseMessage (E4.3 TE-1)", () => {
  it("carries the locked type + identifiers + URL, and NO profile/token values", () => {
    const msg = buildSetActiveCaseMessage(INPUT);
    expect(msg).toEqual({
      type: "SET_ACTIVE_CASE",
      caseId: "case-1",
      providerId: "prov-1",
      orgId: "org-1",
      portalUrl: "https://portal.example/enroll",
    });
    // Exactly the five contract keys — nothing else can ride the message.
    expect(Object.keys(msg).sort()).toEqual(
      ["caseId", "orgId", "portalUrl", "providerId", "type"].sort(),
    );
  });
});

describe("isExtensionMessagingAvailable", () => {
  it("is false when chrome.runtime.sendMessage is absent", () => {
    expect(isExtensionMessagingAvailable()).toBe(false);
    (globalThis as { chrome?: unknown }).chrome = { runtime: {} };
    expect(isExtensionMessagingAvailable()).toBe(false);
  });

  it("is true when chrome.runtime.sendMessage is a function", () => {
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: () => undefined } };
    expect(isExtensionMessagingAvailable()).toBe(true);
  });
});

describe("sendSetActiveCase", () => {
  it("returns false and sends nothing when the extension is absent", () => {
    expect(sendSetActiveCase(INPUT)).toBe(false);
  });

  it("sends the built message and returns true when available", () => {
    const sendMessage = vi.fn();
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    expect(sendSetActiveCase(INPUT)).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(buildSetActiveCaseMessage(INPUT));
  });

  it("never throws when sendMessage throws (a disconnected port must not block the tab)", () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: () => {
          throw new Error("Could not establish connection");
        },
      },
    };
    expect(sendSetActiveCase(INPUT)).toBe(false);
  });
});
