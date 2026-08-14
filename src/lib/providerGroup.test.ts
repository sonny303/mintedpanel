// E1.1 TE-10 — pure provider-group helpers: TIN/NPI format validation,
// display formatting, the block-shaped ↔ flat mapping, and the form truth
// table (TIN required, ≥1 state, billing address required).
import { describe, expect, it } from "vitest";
import {
  EMPTY_GROUP_BLOCK,
  EMPTY_GROUP_FORM,
  formatTin,
  formValueToInput,
  groupFormErrors,
  groupToFormValue,
  hasGroupFormErrors,
  isValidNpi,
  isValidTin,
  normalizeTin,
  type GroupFormValue,
} from "./providerGroup";
import type { ProviderGroup } from "@/types";

const validForm: GroupFormValue = {
  name: "Tree Hill Sports Therapy LLC",
  tin: "12-3456789",
  npiType2: "1234567890",
  states: ["NC"],
  websiteUrl: "",
  billing: {
    ...EMPTY_GROUP_BLOCK,
    street: "500 River Court",
    city: "Tree Hill",
    state: "NC",
    zip: "27514",
  },
  correspondence: EMPTY_GROUP_BLOCK,
  credentialing: EMPTY_GROUP_BLOCK,
};

describe("TIN / NPI format helpers", () => {
  it("normalizes TIN to bare digits and validates 9 digits", () => {
    expect(normalizeTin("12-3456789")).toBe("123456789");
    expect(isValidTin("12-3456789")).toBe(true);
    expect(isValidTin("123456789")).toBe(true);
    expect(isValidTin("12345678")).toBe(false);
    expect(isValidTin("1234567890")).toBe(false);
    expect(isValidTin("")).toBe(false);
  });

  it("formats a 9-digit TIN as XX-XXXXXXX and passes anything else through", () => {
    expect(formatTin("123456789")).toBe("12-3456789");
    expect(formatTin("12-3456789")).toBe("12-3456789");
    expect(formatTin("1234")).toBe("1234");
    expect(formatTin(null)).toBe("");
  });

  it("validates Type 2 NPI as exactly 10 digits", () => {
    expect(isValidNpi("1234567890")).toBe(true);
    expect(isValidNpi("123-456-7890")).toBe(true);
    expect(isValidNpi("123456789")).toBe(false);
    expect(isValidNpi("12345678901")).toBe(false);
  });
});

describe("groupFormErrors", () => {
  it("accepts a valid form", () => {
    expect(hasGroupFormErrors(groupFormErrors(validForm))).toBe(false);
  });

  it("requires legal name, TIN, ≥1 state, and the billing address", () => {
    const e = groupFormErrors({
      ...EMPTY_GROUP_FORM,
    });
    expect(e.name).toBeTruthy();
    expect(e.tin).toBeTruthy();
    expect(e.states).toBeTruthy();
    expect(e.billingStreet).toBeTruthy();
    expect(e.billingCity).toBeTruthy();
    expect(e.billingState).toBeTruthy();
    expect(e.billingZip).toBeTruthy();
  });

  it("rejects a malformed TIN and a malformed optional NPI", () => {
    expect(groupFormErrors({ ...validForm, tin: "12345" }).tin).toBeTruthy();
    expect(groupFormErrors({ ...validForm, npiType2: "123" }).npiType2).toBeTruthy();
    // NPI is optional — blank is fine.
    expect(groupFormErrors({ ...validForm, npiType2: "" }).npiType2).toBeUndefined();
  });

  it("website URL is optional; a value must be a valid http(s) URL", () => {
    expect(groupFormErrors({ ...validForm, websiteUrl: "" }).websiteUrl).toBeUndefined();
    expect(
      groupFormErrors({ ...validForm, websiteUrl: "bestptnc.com" }).websiteUrl,
    ).toBeUndefined();
    expect(
      groupFormErrors({ ...validForm, websiteUrl: "https://bestptnc.com" }).websiteUrl,
    ).toBeUndefined();
    expect(groupFormErrors({ ...validForm, websiteUrl: "not a url" }).websiteUrl).toBeTruthy();
  });
});

describe("block mapping", () => {
  it("folds the block-shaped form into the flat service input (digits stored bare)", () => {
    const input = formValueToInput({
      ...validForm,
      credentialing: {
        ...EMPTY_GROUP_BLOCK,
        street: "77 Credential Way",
        city: "Durham",
        state: "NC",
        zip: "27701",
        contactName: "Casey Credential",
        phone: "919-555-0100",
        fax: "919-555-0101",
        email: "cred@treehill.example.test",
      },
    });
    expect(input.tin).toBe("123456789");
    expect(input.npiType2).toBe("1234567890");
    expect(input.states).toEqual(["NC"]);
    expect(input.billingStreet).toBe("500 River Court");
    expect(input.credentialingContactName).toBe("Casey Credential");
    expect(input.credentialingEmail).toBe("cred@treehill.example.test");
    expect(input.websiteUrl).toBeNull();
    // Empty correspondence block folds to nulls, not empty strings.
    expect(input.correspondenceStreet).toBeNull();
    expect(input.correspondenceEmail).toBeNull();
  });

  it("stores a website URL and prefixes https when the scheme is omitted", () => {
    expect(formValueToInput({ ...validForm, websiteUrl: "https://bestptnc.com" }).websiteUrl).toBe(
      "https://bestptnc.com",
    );
    expect(formValueToInput({ ...validForm, websiteUrl: "bestptnc.com" }).websiteUrl).toBe(
      "https://bestptnc.com",
    );
  });

  it("round-trips a saved row into an editable form value", () => {
    const row = {
      id: "g-1",
      orgId: "o-1",
      name: "Shelby Sports Rehab LLC",
      tin: "987654321",
      npiType2: "0987654321",
      states: ["TN", "AL"],
      isActive: true,
      createdAt: "2026-07-10T00:00:00Z",
      billingStreet: "1 Main St",
      billingCity: "Shelby",
      billingState: "TN",
      billingZip: "37160",
      billingContactName: "Bobby Blanton",
    } as ProviderGroup;
    const v = groupToFormValue(row);
    expect(v.tin).toBe("98-7654321");
    expect(v.states).toEqual(["TN", "AL"]);
    expect(v.billing.street).toBe("1 Main St");
    expect(v.billing.contactName).toBe("Bobby Blanton");
    expect(v.websiteUrl).toBe("");
    // Absent columns come back as empty strings for editing.
    expect(v.credentialing.street).toBe("");
  });
});
