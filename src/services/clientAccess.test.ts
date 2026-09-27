import { describe, expect, it } from "vitest";
import { parseEnrollmentContext } from "./clientAccess";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";

describe("parseEnrollmentContext", () => {
  it("keeps the server-authorized audience and group scopes", () => {
    const context = parseEnrollmentContext({
      actorUserId: ACTOR,
      email: "client@example.test",
      audience: "client",
      selectedOrgId: ORG,
      staffOrgs: [],
      clientOrgs: [
        {
          orgId: ORG,
          orgName: "Shelby Sports Rehab",
          groups: [{ groupId: GROUP, groupName: "Outer Banks Rehab" }],
        },
      ],
      globalTraining: false,
      restrictedExternal: true,
      contextRevision: "revision-a",
    });

    expect(context).toMatchObject({
      actorUserId: ACTOR,
      audience: "client",
      selectedOrgId: ORG,
      restrictedExternal: true,
    });
    expect(context.clientOrgs[0]?.groups).toEqual([
      { groupId: GROUP, groupName: "Outer Banks Rehab" },
    ]);
  });

  it("fails closed when the service omits identity or revision", () => {
    expect(() => parseEnrollmentContext({ contextRevision: "revision-a" })).toThrow(
      "actorUserId is missing",
    );
    expect(() => parseEnrollmentContext({ actorUserId: ACTOR })).toThrow(
      "contextRevision is missing",
    );
  });

  it("drops malformed nested rows instead of inventing access", () => {
    const context = parseEnrollmentContext({
      actorUserId: ACTOR,
      audience: null,
      staffOrgs: [{ orgId: ORG, orgName: "Org", role: "admin" }, { orgId: 4 }],
      clientOrgs: [
        {
          orgId: ORG,
          orgName: "Org",
          groups: [{ groupId: GROUP, groupName: "Group" }, { groupId: null }],
        },
      ],
      contextRevision: "revision-b",
    });

    expect(context.staffOrgs).toHaveLength(1);
    expect(context.clientOrgs[0]?.groups).toHaveLength(1);
  });
});
