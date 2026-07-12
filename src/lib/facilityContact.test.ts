// E1.2 TE-11 — contact-inheritance derivation: facility-own wins, otherwise
// the group's first non-empty block in the locked precedence
// credentialing → correspondence → billing; inherited is display-only.
import { describe, expect, it } from "vitest";
import {
  groupDefaultContact,
  hasReachableContact,
  resolveFacilityContact,
  type ContactChannel,
} from "./facilityContact";
import type { ProviderGroup } from "@/types";

const EMPTY: ContactChannel = { contactName: null, phone: null, fax: null, email: null };

function group(over: Partial<ProviderGroup>): ProviderGroup {
  return {
    id: "g-1",
    orgId: "o-1",
    name: "Tree Hill Sports Therapy LLC",
    tin: "123456789",
    npiType2: null,
    states: ["NC"],
    isActive: true,
    createdAt: "2026-07-10T00:00:00Z",
    ...over,
  };
}

describe("resolveFacilityContact", () => {
  it("uses the facility's own contact when any channel is present", () => {
    const resolved = resolveFacilityContact(
      { ...EMPTY, phone: "919-555-0100" },
      group({ billingPhone: "704-555-0000" }),
    );
    expect(resolved.source).toBe("facility");
    expect(resolved.inherited).toBe(false);
    expect(resolved.phone).toBe("919-555-0100");
  });

  it("inherits the group's first non-empty block in precedence order", () => {
    const g = group({
      billingContactName: "Billing Bob",
      billingPhone: "111",
      correspondencePhone: "222",
      credentialingContactName: "Casey Credential",
      credentialingPhone: "333",
    });
    const resolved = resolveFacilityContact(EMPTY, g);
    expect(resolved.source).toBe("credentialing");
    expect(resolved.inherited).toBe(true);
    expect(resolved.phone).toBe("333");
    expect(resolved.contactName).toBe("Casey Credential");
  });

  it("falls through credentialing → correspondence → billing", () => {
    expect(resolveFacilityContact(EMPTY, group({ correspondenceFax: "555" })).source).toBe(
      "correspondence",
    );
    expect(resolveFacilityContact(EMPTY, group({ billingEmail: "b@x.test" })).source).toBe(
      "billing",
    );
  });

  it("whitespace-only values don't count as populated", () => {
    const resolved = resolveFacilityContact(
      { ...EMPTY, phone: "   " },
      group({ billingPhone: "704-555-0000" }),
    );
    expect(resolved.source).toBe("billing");
    expect(resolved.inherited).toBe(true);
  });

  it("returns a null source when neither facility nor group has a channel", () => {
    const resolved = resolveFacilityContact(EMPTY, group({}));
    expect(resolved.source).toBeNull();
    expect(resolveFacilityContact(EMPTY, null).source).toBeNull();
  });
});

describe("hasReachableContact (minimum-to-save rule)", () => {
  it("true for own channel, true for inherited, false for neither", () => {
    expect(hasReachableContact({ ...EMPTY, contactName: "Front Desk" }, null)).toBe(true);
    expect(hasReachableContact(EMPTY, group({ billingPhone: "704" }))).toBe(true);
    expect(hasReachableContact(EMPTY, group({}))).toBe(false);
    expect(hasReachableContact(EMPTY, null)).toBe(false);
  });
});

describe("groupDefaultContact", () => {
  it("exposes the winning block for the inherited-from label", () => {
    const hit = groupDefaultContact(group({ correspondencePhone: "222" }));
    expect(hit?.block).toBe("correspondence");
    expect(hit?.channel.phone).toBe("222");
    expect(groupDefaultContact(group({}))).toBeNull();
  });
});
