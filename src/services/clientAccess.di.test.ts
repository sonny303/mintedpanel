import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  claimClientInvite,
  createClientInvite,
  resolveEnrollmentContext,
  revokeClientAccess,
  setClientGroupGrants,
} from "./clientAccess";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const ACCESS = "44444444-4444-4444-8444-444444444444";

function fakeDb(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  return { db: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("client access service RPC seam", () => {
  it("binds context resolution to the verified actor and selection", async () => {
    const { db, rpc } = fakeDb({
      actorUserId: ACTOR,
      email: "client@example.test",
      audience: "client",
      selectedOrgId: ORG,
      staffOrgs: [],
      clientOrgs: [],
      globalTraining: false,
      restrictedExternal: true,
      contextRevision: "revision-a",
    });

    await resolveEnrollmentContext({ db, actorUserId: ACTOR }, { audience: "client", orgId: ORG });

    expect(rpc).toHaveBeenCalledWith("resolve_enrollment_context", {
      p_actor_user_id: ACTOR,
      p_audience: "client",
      p_org_id: ORG,
    });
  });

  it("passes the verified actor through invite claim and management calls", async () => {
    const invite = fakeDb({
      inviteId: "55555555-5555-4555-8555-555555555555",
      organizationId: ORG,
      recipientUserId: ACTOR,
      recipientEmail: "client@example.test",
      token: "one-time-token",
      expiresAt: "2026-10-01T00:00:00Z",
    });
    await createClientInvite(
      { db: invite.db, actorUserId: ACTOR },
      { orgId: ORG, recipientEmail: "client@example.test", groupIds: [GROUP] },
    );
    expect(invite.rpc).toHaveBeenCalledWith("create_client_invite", {
      p_actor_user_id: ACTOR,
      p_org_id: ORG,
      p_recipient_email: "client@example.test",
      p_group_ids: [GROUP],
    });

    const claim = fakeDb({ accessId: ACCESS, organizationId: ORG, groupIds: [GROUP] });
    await claimClientInvite({ db: claim.db, actorUserId: ACTOR }, "one-time-token");
    expect(claim.rpc).toHaveBeenCalledWith("claim_client_invite", {
      p_actor_user_id: ACTOR,
      p_token: "one-time-token",
    });

    const grants = fakeDb({ accessId: ACCESS, organizationId: ORG, groupIds: [GROUP] });
    await setClientGroupGrants(
      { db: grants.db, actorUserId: ACTOR },
      { accessId: ACCESS, groupIds: [GROUP] },
    );
    expect(grants.rpc).toHaveBeenCalledWith("set_client_group_grants", {
      p_actor_user_id: ACTOR,
      p_access_id: ACCESS,
      p_group_ids: [GROUP],
    });

    const revoke = fakeDb({ accessId: ACCESS, organizationId: ORG, state: "revoked" });
    await revokeClientAccess({ db: revoke.db, actorUserId: ACTOR }, ACCESS);
    expect(revoke.rpc).toHaveBeenCalledWith("revoke_client_access", {
      p_actor_user_id: ACTOR,
      p_access_id: ACCESS,
    });
  });

  it("does not turn an RPC error into an authorized empty response", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "forbidden" } });
    const db = { rpc } as unknown as SupabaseClient<Database>;

    await expect(resolveEnrollmentContext({ db, actorUserId: ACTOR })).rejects.toThrow("forbidden");
  });
});
