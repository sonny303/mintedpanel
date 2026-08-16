import { describe, it, expect } from "vitest";
import {
  CONTACT_TOKEN_FAMILIES,
  CONTACT_TOKEN_FIELDS,
  orgContactTokenKeys,
  resolveOrgContactTokens,
  contactFamilyLabel,
} from "./orgContactTokens";
import { emailValuedTokenKeys, isResolvableToken } from "./sopResolver";
import type { Party, PartyRoleKey } from "@/types";

function party(over: Partial<Party> = {}): Party {
  return {
    id: "p-1",
    orgId: "org-1",
    partyType: "person",
    name: "Dana Reyes",
    firstName: "Dana",
    lastName: "Reyes",
    title: "Managing Partner",
    email: "dana@example.test",
    phoneOffice: "704-555-0100",
    phoneExtension: "204",
    phoneMobile: "704-555-0199",
    fax: "704-555-0111",
    addressLine1: "101 S Tryon St",
    addressLine2: "Suite 400",
    city: "Charlotte",
    state: "NC",
    postalCode: "28280",
    country: "US",
    createdBy: "u-1",
    createdAt: "2026-08-07T00:00:00Z",
    ...over,
  };
}

describe("token key surface", () => {
  it("emits every field for every family, flat camelCase (D10)", () => {
    const keys = orgContactTokenKeys();
    expect(keys).toHaveLength(CONTACT_TOKEN_FAMILIES.length * CONTACT_TOKEN_FIELDS.length);
    expect(keys).toContain("billingContact.email");
    expect(keys).toContain("credentialingContact.phoneExtension");
    expect(keys).toContain("contractingSigner.title");
  });

  it("uses no nested or snake_case spellings — the join is a literal match", () => {
    for (const key of orgContactTokenKeys()) {
      expect(key.split(".")).toHaveLength(2);
      expect(key).not.toMatch(/_/);
      expect(key).not.toMatch(/^party\./);
    }
  });

  it("has no duplicate keys", () => {
    const keys = orgContactTokenKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("resolveOrgContactTokens", () => {
  const roleOf = (prefix: string) =>
    CONTACT_TOKEN_FAMILIES.find((f) => f.prefix === prefix)!.roleKey;

  it("resolves the default holder's values", () => {
    const map = new Map<PartyRoleKey, Party | null>([[roleOf("billingContact"), party()]]);
    const { tokens } = resolveOrgContactTokens(map);
    const byKey = new Map(tokens.map((t) => [t.token, t.value]));
    expect(byKey.get("billingContact.firstName")).toBe("Dana");
    expect(byKey.get("billingContact.lastName")).toBe("Reyes");
    expect(byKey.get("billingContact.email")).toBe("dana@example.test");
    expect(byKey.get("billingContact.phoneExtension")).toBe("204");
    expect(byKey.get("billingContact.fax")).toBe("704-555-0111");
    expect(byKey.get("billingContact.title")).toBe("Managing Partner");
  });

  it("composes fullName so a single-box form needs no mapping-time concatenation", () => {
    const map = new Map<PartyRoleKey, Party | null>([[roleOf("billingContact"), party()]]);
    const { tokens } = resolveOrgContactTokens(map);
    const full = tokens.find((t) => t.token === "billingContact.fullName");
    expect(full?.value).toBe("Dana Reyes");
  });

  it("falls back to the stored display name for a party predating the split", () => {
    const legacy = party({ firstName: null, lastName: null, name: "Marc Douek" });
    const map = new Map<PartyRoleKey, Party | null>([[roleOf("billingContact"), legacy]]);
    const { tokens } = resolveOrgContactTokens(map);
    const byKey = new Map(tokens.map((t) => [t.token, t.value]));
    expect(byKey.get("billingContact.fullName")).toBe("Marc Douek");
    expect(byKey.get("billingContact.firstName")).toBeNull();
  });

  it("emits null + an honest reason for a role with no default holder", () => {
    const { tokens, unresolved } = resolveOrgContactTokens(new Map());
    // Every key is still PRESENT — never silently omitted, so the extension can
    // tell the coordinator exactly which contact is missing.
    expect(tokens).toHaveLength(orgContactTokenKeys().length);
    expect(tokens.every((t) => t.value === null)).toBe(true);
    expect(unresolved).toHaveLength(orgContactTokenKeys().length);
    expect(unresolved[0].reason).toMatch(/no default .* set for this organization/);
  });

  it("reports a blank individual field as unresolved, not as an empty string", () => {
    const noFax = party({ fax: null, phoneMobile: "   " });
    const map = new Map<PartyRoleKey, Party | null>([[roleOf("contractingSigner"), noFax]]);
    const { tokens, unresolved } = resolveOrgContactTokens(map);
    const byKey = new Map(tokens.map((t) => [t.token, t.value]));
    expect(byKey.get("contractingSigner.fax")).toBeNull();
    expect(byKey.get("contractingSigner.phoneMobile")).toBeNull();
    expect(unresolved.map((u) => u.token)).toContain("contractingSigner.fax");
    expect(unresolved.map((u) => u.token)).toContain("contractingSigner.phoneMobile");
  });

  it("trims resolved values", () => {
    const padded = party({ email: "  dana@example.test  " });
    const map = new Map<PartyRoleKey, Party | null>([[roleOf("credentialingContact"), padded]]);
    const { tokens } = resolveOrgContactTokens(map);
    const email = tokens.find((t) => t.token === "credentialingContact.email");
    expect(email?.value).toBe("dana@example.test");
  });

  it("keeps families independent — one missing role never blanks another", () => {
    const map = new Map<PartyRoleKey, Party | null>([[roleOf("billingContact"), party()]]);
    const { tokens } = resolveOrgContactTokens(map);
    const byKey = new Map(tokens.map((t) => [t.token, t.value]));
    expect(byKey.get("billingContact.email")).toBe("dana@example.test");
    expect(byKey.get("credentialingContact.email")).toBeNull();
  });
});

describe("D12 — fill-time only, never baked into a SOP body", () => {
  it("no contact token is resolvable by the SOP resolver", () => {
    // A token in buildTokenMap reaches the authoring picker and gets INTERPOLATED
    // into tasks.sop_content at case creation — a snapshot that would go stale
    // the moment the contact changed. Contacts resolve at fill time instead.
    for (const key of orgContactTokenKeys()) {
      expect(isResolvableToken(key)).toBe(false);
    }
  });
});

describe("D13 — contacts are values, not email recipients", () => {
  it("no contact token is an email-valued recipient token", () => {
    const recipients = emailValuedTokenKeys();
    for (const key of orgContactTokenKeys()) {
      expect(recipients).not.toContain(key);
    }
    // The closed recipient set stays exactly what it was.
    expect(recipients).toEqual(["provider.email"]);
  });
});

describe("contactFamilyLabel", () => {
  it("labels every shipped family", () => {
    for (const { prefix } of CONTACT_TOKEN_FAMILIES) {
      expect(contactFamilyLabel(prefix)).not.toBe(prefix);
    }
  });
});
