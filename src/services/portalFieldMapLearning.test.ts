import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { batchLearnPortalFieldMaps, validateBatchLearnInput } from "./portalFieldMapLearning";

const requestBody = {
  case_id: "11111111-1111-4111-8111-111111111111",
  provider_id: "22222222-2222-4222-8222-222222222222",
  fill_session_id: "33333333-3333-4333-8333-333333333333",
  portal_key: "Availity",
  page_url: "https://portal.example/forms/app?case=secret#step",
  mappings: [
    { selector: "#provider-npi", token: "provider.npi", confidence: 0.91, field_type: "text" },
  ],
};

function dbWithRpc(responses: Array<{ data: unknown; error: null | Error }>) {
  const rpc = vi.fn(
    async (..._args: unknown[]) =>
      responses.shift() ?? { data: null, error: new Error("unexpected RPC") },
  );
  return { db: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("validateBatchLearnInput", () => {
  it("normalizes the portal and strips query/hash from the persisted URL scope", () => {
    const result = validateBatchLearnInput(requestBody);
    expect(result).toEqual({
      ok: true,
      input: expect.objectContaining({
        portalKey: "availity",
        urlPattern: "https://portal.example/forms/app",
      }),
    });
  });

  it.each([
    ["unknown root key", { ...requestBody, org_id: "attacker-org" }],
    [
      "raw mapping property",
      { ...requestBody, mappings: [{ ...requestBody.mappings[0], value: "secret" }] },
    ],
    [
      "non-catalog token",
      { ...requestBody, mappings: [{ ...requestBody.mappings[0], token: "private arbitrary" }] },
    ],
    [
      "SSN token",
      { ...requestBody, mappings: [{ ...requestBody.mappings[0], token: "provider.ssnLast4" }] },
    ],
    [
      "low confidence",
      { ...requestBody, mappings: [{ ...requestBody.mappings[0], confidence: 0.849 }] },
    ],
    [
      "duplicate selector",
      { ...requestBody, mappings: [requestBody.mappings[0], requestBody.mappings[0]] },
    ],
    [
      "value-based selector",
      { ...requestBody, mappings: [{ ...requestBody.mappings[0], selector: '[value="secret"]' }] },
    ],
    [
      "file field type",
      { ...requestBody, mappings: [{ ...requestBody.mappings[0], field_type: "file" }] },
    ],
  ])("rejects %s", (_name, body) => {
    expect(validateBatchLearnInput(body).ok).toBe(false);
  });

  it("rejects a URL containing credentials and oversized mapping batches", () => {
    expect(
      validateBatchLearnInput({
        ...requestBody,
        page_url: "https://name:secret@portal.example/app",
      }).ok,
    ).toBe(false);
    expect(
      validateBatchLearnInput({ ...requestBody, mappings: Array(33).fill(requestBody.mappings[0]) })
        .ok,
    ).toBe(false);
  });
});

describe("batchLearnPortalFieldMaps", () => {
  it("uses the live token catalog and derives org/actor only from context", async () => {
    const { db, rpc } = dbWithRpc([
      { data: [{ token: "provider.npi" }, { token: "provider.firstName" }], error: null },
      {
        data: {
          kind: "ok",
          inserted_count: 1,
          confirmed_saved_count: 1,
          preserved_count: 0,
          results: [{ selector: "#provider-npi", token: "provider.npi", outcome: "inserted" }],
        },
        error: null,
      },
    ]);

    const result = await batchLearnPortalFieldMaps(
      { db, orgId: "org-from-auth", userId: "actor-from-auth" },
      requestBody,
    );
    expect(result.kind).toBe("ok");
    expect(rpc).toHaveBeenNthCalledWith(1, "get_sop_field_tokens");
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "learn_portal_field_maps_from_touch",
      expect.objectContaining({
        p_org_id: "org-from-auth",
        p_actor_id: "actor-from-auth",
        p_portal_key: "availity",
        p_url_pattern: "https://portal.example/forms/app",
      }),
    );
    const rpcArgs = rpc.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(rpcArgs)).not.toContain("secret");
    expect(rpcArgs.p_org_id).toBe("org-from-auth");
    expect(rpcArgs.p_actor_id).toBe("actor-from-auth");
  });

  it("rejects tokens outside the live schema and exact user/contact families before the write RPC", async () => {
    const { db, rpc } = dbWithRpc([{ data: [{ token: "provider.npi" }], error: null }]);
    const result = await batchLearnPortalFieldMaps(
      { db, orgId: "org-1", userId: "actor-1" },
      { ...requestBody, mappings: [{ ...requestBody.mappings[0], token: "provider.unknown" }] },
    );
    expect(result).toMatchObject({ kind: "rejected", status: 422 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed if the exact approved response shape is missing", async () => {
    const { db } = dbWithRpc([
      { data: [{ token: "provider.npi" }], error: null },
      { data: { kind: "ok", inserted_count: 1 }, error: null },
    ]);
    await expect(
      batchLearnPortalFieldMaps({ db, orgId: "org-1", userId: "actor-1" }, requestBody),
    ).rejects.toThrow("invalid response");
  });
});
