import { describe, expect, it, vi } from "vitest";
import { mergeCurrentUserAndContactTokens } from "./useFreshPdfTokenValues";
import { isSamePdfActorContext } from "@/lib/fillRunGuard";
import type { OrgParty } from "@/types";

vi.mock("@/lib/auth-store", () => ({
  useAuthStore: Object.assign(() => undefined, {
    getState: () => ({
      activeOrgId: "org-a",
      user: { id: "actor-a", email: null, user_metadata: null },
      authGeneration: 1,
      contextEpoch: 1,
    }),
  }),
}));
vi.mock("@/services/parties", () => ({ listOrgParties: vi.fn() }));
vi.mock("@/services/userProfile", () => ({ getMyProfile: vi.fn() }));

describe("mergeCurrentUserAndContactTokens", () => {
  it("replaces stale user/contact values with the shared canonical current-source projection", () => {
    const orgParties = [
      {
        party: {
          firstName: "Morgan",
          lastName: "Lee",
          name: "Morgan Lee",
          phoneOffice: "555-0102",
          email: "billing@example.test",
        },
        defaultRoleKeys: ["billing_contact"],
        roleKeys: ["billing_contact"],
      },
    ] as unknown as OrgParty[];

    const result = mergeCurrentUserAndContactTokens(
      {
        "provider.npi": "1003456701",
        "user.name": "Stale User",
        "billingContact.fullName": "Stale Billing Contact",
        "credentialingContact.email": "stale@example.test",
      },
      {
        id: "actor-1",
        firstName: "Casey",
        lastName: "Ng",
        title: "Coordinator",
        fullName: "Casey Ng",
        email: "casey@example.test",
      },
      { email: "casey@example.test", userMetadata: { name: "Old Auth Name" } },
      orgParties,
    );

    expect(result).toMatchObject({
      "provider.npi": "1003456701",
      "user.name": "Casey Ng",
      "user.firstName": "Casey",
      "user.lastName": "Ng",
      "user.title": "Coordinator",
      "user.email": "casey@example.test",
      "billingContact.fullName": "Morgan Lee",
      "billingContact.phoneOffice": "555-0102",
    });
    expect(result).not.toHaveProperty("credentialingContact.email");
    expect(result).not.toHaveProperty("user.fullName");
  });
});

describe("isSamePdfActorContext", () => {
  const origin = {
    orgId: "org-a",
    userId: "actor-a",
    authGeneration: 4,
    contextEpoch: 8,
  };

  it.each([
    ["organization", { ...origin, orgId: "org-b" }],
    ["actor", { ...origin, userId: "actor-b" }],
    ["auth generation", { ...origin, authGeneration: 5 }],
    ["context epoch", { ...origin, contextEpoch: 9 }],
  ])("invalidates the captured fill after a %s change", (_label, current) => {
    expect(isSamePdfActorContext(origin, current)).toBe(false);
  });

  it("accepts an unchanged actor and organization context", () => {
    expect(isSamePdfActorContext(origin, { ...origin })).toBe(true);
  });
});
