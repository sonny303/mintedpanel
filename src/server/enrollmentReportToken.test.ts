import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EnrollmentReportTokenContext } from "./enrollmentReportToken";
import {
  createEnrollmentReportCursor,
  createEnrollmentReportViewToken,
  verifyEnrollmentReportCursor,
  verifyEnrollmentReportViewToken,
} from "./enrollmentReportToken";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const ORG_ID = "20000000-0000-4000-8000-000000000001";
const PROVIDER_ID = "30000000-0000-4000-8000-000000000001";
const CONTEXT_REVISION = "e6.14-test-context";

const context: EnrollmentReportTokenContext = {
  actorUserId: ACTOR_ID,
  orgId: ORG_ID,
  audience: "client",
  contextRevision: CONTEXT_REVISION,
  filters: { groupId: "40000000-0000-4000-8000-000000000001", state: "CO" },
};

let previousServiceKey: string | undefined;

beforeEach(() => {
  previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-server-side-service-key";
});

afterEach(() => {
  if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
});

describe("enrollment report snapshot tokens", () => {
  it("binds the exact audience, context, filters and recomputed digest", () => {
    const now = 1_800_000_000_000;
    const token = createEnrollmentReportViewToken(context, "f".repeat(64), now);
    expect(verifyEnrollmentReportViewToken(token, context, "f".repeat(64), now + 1)).toBe(true);
    expect(verifyEnrollmentReportViewToken(token, context, "e".repeat(64), now + 1)).toBe(false);
    expect(
      verifyEnrollmentReportViewToken(
        token,
        { ...context, audience: "staff" },
        "f".repeat(64),
        now + 1,
      ),
    ).toBe(false);
    expect(
      verifyEnrollmentReportViewToken(
        token,
        { ...context, actorUserId: "10000000-0000-4000-8000-000000000002" },
        "f".repeat(64),
        now + 1,
      ),
    ).toBe(false);
    expect(
      verifyEnrollmentReportViewToken(
        token,
        { ...context, orgId: "20000000-0000-4000-8000-000000000002" },
        "f".repeat(64),
        now + 1,
      ),
    ).toBe(false);
    expect(
      verifyEnrollmentReportViewToken(
        token,
        { ...context, contextRevision: "e6.14-next-context" },
        "f".repeat(64),
        now + 1,
      ),
    ).toBe(false);
    expect(
      verifyEnrollmentReportViewToken(
        token,
        { ...context, filters: { ...context.filters, state: "UT" } },
        "f".repeat(64),
        now + 1,
      ),
    ).toBe(false);
  });

  it("expires views and signs a cursor to its view token", () => {
    const now = 1_800_000_000_000;
    const token = createEnrollmentReportViewToken(context, "a".repeat(64), now);
    expect(verifyEnrollmentReportViewToken(token, context, "a".repeat(64), now + 600_000)).toBe(
      false,
    );
    const key = {
      lastName: "provider",
      firstName: "ada",
      providerId: PROVIDER_ID,
    };
    const cursor = createEnrollmentReportCursor(token, key);
    expect(verifyEnrollmentReportCursor(cursor, token)).toEqual(key);
    expect(verifyEnrollmentReportCursor(cursor, `${token}x`)).toBeNull();
    expect(verifyEnrollmentReportCursor(`${cursor.slice(0, -2)}aa`, token)).toBeNull();
  });

  it("keeps the canonical digest out of the client-visible token", () => {
    const digest = "deadbeef".repeat(8);
    const token = createEnrollmentReportViewToken(context, digest, 1_800_000_000_000);
    expect(token).not.toContain(digest);
    expect(token.startsWith("e614r1.")).toBe(true);
  });

  it("denies tokens after key rotation or when the server key is unavailable", () => {
    const now = 1_800_000_000_000;
    const token = createEnrollmentReportViewToken(context, "b".repeat(64), now);
    const cursor = createEnrollmentReportCursor(token, {
      lastName: "provider",
      firstName: "ada",
      providerId: PROVIDER_ID,
    });

    process.env.SUPABASE_SERVICE_ROLE_KEY = "rotated-server-side-service-key";
    expect(verifyEnrollmentReportViewToken(token, context, "b".repeat(64), now + 1)).toBe(false);
    expect(verifyEnrollmentReportCursor(cursor, token)).toBeNull();

    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(verifyEnrollmentReportViewToken(token, context, "b".repeat(64), now + 1)).toBe(false);
    expect(verifyEnrollmentReportCursor(cursor, token)).toBeNull();
    expect(() => createEnrollmentReportViewToken(context, "b".repeat(64), now)).toThrow(
      "Server Supabase service key is unavailable",
    );
  });
});
