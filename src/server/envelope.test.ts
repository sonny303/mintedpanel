import { describe, it, expect } from "vitest";
import { ok, fail, type ApiEnvelope } from "./envelope";

async function parse(res: Response): Promise<ApiEnvelope<unknown>> {
  return (await res.json()) as ApiEnvelope<unknown>;
}

describe("api envelope", () => {
  it("ok() returns { data, error:null, meta } with 200 by default", async () => {
    const res = ok([1, 2], { total: 2, page: 1, pageSize: 25 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await parse(res);
    expect(body).toEqual({ data: [1, 2], error: null, meta: { total: 2, page: 1, pageSize: 25 } });
  });

  it("ok() honors a custom status and null meta", async () => {
    const res = ok({ id: "x" }, null, 201);
    expect(res.status).toBe(201);
    const body = await parse(res);
    expect(body).toEqual({ data: { id: "x" }, error: null, meta: null });
  });

  it("fail() returns { data:null, error, meta:null } with the given status", async () => {
    const res = fail(403, "nope");
    expect(res.status).toBe(403);
    const body = await parse(res);
    expect(body).toEqual({ data: null, error: "nope", meta: null });
  });
});
