import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildOpenPortalMessage,
  buildSetActiveCaseMessage,
  isExtensionMessagingAvailable,
  sendOpenPortal,
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

describe("S3.5 — the widened C1 payload", () => {
  const base = {
    caseId: "c1",
    providerId: "p1",
    orgId: "o1",
    portalUrl: "https://portal.test/form",
  };

  it("carries portalKey and facilityId when the case has them", () => {
    const message = buildSetActiveCaseMessage({
      ...base,
      portalKey: "bcbs_ks_enrollment",
      facilityId: "f1",
    });
    expect(message.portalKey).toBe("bcbs_ks_enrollment");
    expect(message.facilityId).toBe("f1");
  });

  it("OMITS the optional fields rather than sending null", () => {
    // The extension strict-parses; a null would be dropped anyway, but keeping
    // the wire shape minimal means an older extension sees exactly the locked
    // TE-1 message it already understands.
    const message = buildSetActiveCaseMessage({ ...base, portalKey: null, facilityId: null });
    expect("portalKey" in message).toBe(false);
    expect("facilityId" in message).toBe(false);
    expect(message).toEqual({ type: "SET_ACTIVE_CASE", ...base });
  });

  it("still carries IDENTIFIERS + URL only — no profile or token value", () => {
    const message = buildSetActiveCaseMessage({
      ...base,
      portalKey: "k",
      facilityId: "f1",
    });
    expect(Object.keys(message).sort()).toEqual(
      ["caseId", "facilityId", "orgId", "portalKey", "portalUrl", "providerId", "type"].sort(),
    );
  });
});

// The SETUP intent. Same channel and same never-throw discipline as the case
// handoff; the point of these tests is that it stays structurally caseless, so
// a setup launch can capture a form and can never reach the fill path.
describe("buildOpenPortalMessage / sendOpenPortal — portal setup", () => {
  const SETUP = {
    portalUrl: "https://extaz-oci.aetna.com/pocui/join-the-aetna-network",
    portalKey: "aetna-network",
    orgId: "org-1",
  };

  it("carries only the portal + optional context — nothing case-shaped", () => {
    const msg = buildOpenPortalMessage(SETUP);
    expect(msg).toEqual({
      type: "OPEN_PORTAL",
      portalUrl: SETUP.portalUrl,
      portalKey: "aetna-network",
      orgId: "org-1",
    });
    // If either of these ever appears here, the extension's parser rejects the
    // whole message — the two intents are deliberately non-overlapping.
    expect(msg).not.toHaveProperty("caseId");
    expect(msg).not.toHaveProperty("providerId");
  });

  it("OMITS absent optionals rather than sending nulls", () => {
    const msg = buildOpenPortalMessage({
      portalUrl: SETUP.portalUrl,
      portalKey: null,
      orgId: null,
    });
    expect(Object.keys(msg).sort()).toEqual(["portalUrl", "type"]);
  });

  it("returns false and sends nothing when the extension is absent", () => {
    expect(sendOpenPortal(SETUP)).toBe(false);
  });

  it("sends the built message and returns true when available", () => {
    const sendMessage = vi.fn();
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    expect(sendOpenPortal(SETUP)).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(buildOpenPortalMessage(SETUP));
  });

  it("never throws — a messaging failure must not block opening the portal tab", () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: () => {
          throw new Error("Could not establish connection");
        },
      },
    };
    expect(sendOpenPortal(SETUP)).toBe(false);
  });
});
