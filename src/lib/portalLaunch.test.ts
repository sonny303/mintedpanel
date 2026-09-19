import { describe, expect, it, vi } from "vitest";
import type { ExtensionHandoffResult, SetActiveCaseInput } from "./extensionHandoff";
import {
  beginPortalLaunch,
  createPortalLaunchContextKey,
  createPortalLaunchGuard,
} from "./portalLaunch";
import { SET_ACTIVE_CASE_INPUT_FIXTURE } from "@/testFixtures/extensionHandoff";

const INPUT: SetActiveCaseInput = SET_ACTIVE_CASE_INPUT_FIXTURE;

describe("beginPortalLaunch", () => {
  it("initiates the handoff and exactly one isolated portal open before receipt persistence finishes", async () => {
    const calls: string[] = [];
    let resolveReceipt: (value: ExtensionHandoffResult) => void = () => undefined;
    const send = vi.fn(() => {
      calls.push("send-started");
      return new Promise<ExtensionHandoffResult>((resolve) => {
        resolveReceipt = (value) => {
          calls.push("receipt-finished");
          resolve(value);
        };
      });
    });
    const open = vi.fn(() => {
      calls.push("portal-requested");
      return null;
    });

    const launch = beginPortalLaunch(INPUT, { send, open });
    expect(calls).toEqual(["send-started", "portal-requested"]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      "https://portal.example/enroll",
      "_blank",
      "noopener,noreferrer",
    );
    expect(launch.portalStatus).toBe("requested");

    resolveReceipt({ status: "received" });
    await expect(launch.receipt).resolves.toEqual({ status: "received" });
    expect(calls).toEqual(["send-started", "portal-requested", "receipt-finished"]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("does not retry navigation after rejection, failure, or timeout", async () => {
    for (const result of [
      { status: "rejected" } as const,
      { status: "failed" } as const,
      { status: "timeout" } as const,
    ]) {
      const open = vi.fn(() => null);
      const launch = beginPortalLaunch(INPUT, { send: () => Promise.resolve(result), open });
      await launch.receipt;
      expect(open).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps the receipt alive and reports a failed portal request when window.open throws", async () => {
    const launch = beginPortalLaunch(INPUT, {
      send: () => Promise.resolve({ status: "received" }),
      open: () => {
        throw new Error("window closed");
      },
    });
    expect(launch.portalStatus).toBe("failed");
    await expect(launch.receipt).resolves.toEqual({ status: "received" });
  });
});

describe("createPortalLaunchGuard", () => {
  it("lets B supersede delayed A", () => {
    const guard = createPortalLaunchGuard();
    const a = guard.begin();
    const b = guard.begin();
    expect(guard.isCurrent(a)).toBe(false);
    expect(guard.isCurrent(b)).toBe(true);
  });

  it("invalidates pending completion for case/org/logout changes or unmount", () => {
    const guard = createPortalLaunchGuard();
    const pending = guard.begin();
    guard.invalidate();
    expect(guard.isCurrent(pending)).toBe(false);
  });
});

describe("createPortalLaunchContextKey", () => {
  const context = {
    authUserId: "user-a",
    authSessionExpiresAt: 1_800_000_000,
    activeOrgId: "20563fd6-8e95-46a0-8e1c-cb3b968b3c3d",
    orgId: "20563fd6-8e95-46a0-8e1c-cb3b968b3c3d",
    caseId: "b7a90000-0000-4000-a000-0000000000c1",
    providerId: "49ad83a8-d8b6-419d-8dcc-88c04a54c4da",
    portalKey: "regional_enrollment",
    portalUrl: "https://portal.example/enroll",
    facilityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  };

  it("changes for same-org account switches, session replacement, and logout", () => {
    const current = createPortalLaunchContextKey(context);
    expect(createPortalLaunchContextKey({ ...context, authUserId: "user-b" })).not.toBe(current);
    expect(
      createPortalLaunchContextKey({ ...context, authSessionExpiresAt: 1_800_000_001 }),
    ).not.toBe(current);
    expect(
      createPortalLaunchContextKey({
        ...context,
        authUserId: null,
        authSessionExpiresAt: null,
      }),
    ).not.toBe(current);
  });
});
