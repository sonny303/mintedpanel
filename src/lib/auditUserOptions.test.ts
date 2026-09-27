import { describe, expect, it } from "vitest";
import { auditUserOptions } from "./auditUserOptions";

const actorId = "12345678-0000-0000-0000-000000000001";

describe("auditUserOptions", () => {
  it("keeps a known actor name when older audit rows omit it", () => {
    expect(
      auditUserOptions([
        { userId: actorId, userName: "Sowmya S" },
        { userId: actorId, userName: null },
      ]),
    ).toEqual([{ id: actorId, name: "Sowmya S" }]);
  });

  it("uses a later named row when the newest row has no name", () => {
    expect(
      auditUserOptions([
        { userId: actorId, userName: null },
        { userId: actorId, userName: "Sowmya S" },
      ]),
    ).toEqual([{ id: actorId, name: "Sowmya S" }]);
  });

  it("falls back to the ID only when no sampled row has a name", () => {
    expect(
      auditUserOptions([
        { userId: null, userName: null },
        { userId: actorId, userName: null },
      ]),
    ).toEqual([{ id: actorId, name: "12345678" }]);
  });
});
