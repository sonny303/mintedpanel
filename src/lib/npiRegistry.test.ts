// MINT-110 — NPI Registry pure rules: what the route accepts, how a typed
// name is compared with the registry's, and the note shown under the NPI.
import { describe, expect, it } from "vitest";
import {
  NPI_REGISTRY_UNAVAILABLE_MESSAGE,
  compareNpiRegistryName,
  foldNameForRegistry,
  npiVerificationView,
  registrySummary,
  validateNpiRegistryLookup,
  validateNpiRegistrySearch,
  type NpiRegistryRecord,
} from "./npiRegistry";

const jane: NpiRegistryRecord = {
  npi: "1234567893",
  enumerationType: "NPI-1",
  firstName: "JANE",
  middleName: "A",
  lastName: "DOE",
  organizationName: null,
  credential: "PT, DPT",
  primaryTaxonomy: { code: "225100000X", description: "Physical Therapist" },
  practiceCity: "DENVER",
  practiceState: "CO",
  status: "active",
  enumerationDate: "2015-03-02",
  otherNames: [{ firstName: "JANE", lastName: "SMITH" }],
};

describe("validateNpiRegistrySearch", () => {
  it("requires a first and last name and treats state as optional", () => {
    expect(validateNpiRegistrySearch({ firstName: " Jane ", lastName: "Doe" })).toEqual({
      ok: true,
      value: { firstName: "Jane", lastName: "Doe", state: null },
    });
    expect(validateNpiRegistrySearch({ firstName: "Jane", lastName: "Doe", state: "co" })).toEqual({
      ok: true,
      value: { firstName: "Jane", lastName: "Doe", state: "CO" },
    });
    for (const input of [{}, null, "x", [], { firstName: "Jane" }, { lastName: "Doe" }]) {
      expect(validateNpiRegistrySearch(input).ok).toBe(false);
    }
  });

  it("accepts real-world names and rejects wildcards, digits and long input", () => {
    for (const lastName of ["O'Brien", "Smith-Jones", "St. John", "Núñez", "van der Berg"]) {
      expect(validateNpiRegistrySearch({ firstName: "Ana", lastName }).ok).toBe(true);
    }
    for (const lastName of ["Do*", "D0e", "Doe;", "<b>", "-Doe", "x".repeat(36)]) {
      expect(validateNpiRegistrySearch({ firstName: "Ana", lastName }).ok).toBe(false);
    }
  });

  it("returns the folded names the registry is asked for", () => {
    expect(validateNpiRegistrySearch({ firstName: "J.", lastName: "Strau\u00df, Jr." })).toEqual({
      ok: true,
      value: { firstName: "J", lastName: "Strauss", state: null },
    });
    expect(
      validateNpiRegistrySearch({ firstName: "\u0141ukasz", lastName: "O\u2019Brien" }),
    ).toMatchObject({ ok: true, value: { firstName: "Lukasz", lastName: "O'Brien" } });
  });

  it("422s a name with letters the registry cannot take, naming the character", () => {
    const chinese = validateNpiRegistrySearch({ firstName: "Wei", lastName: "\u674e" });
    expect(chinese.ok).toBe(false);
    expect(!chinese.ok && chinese.error).toContain('"\u674e" can\'t be searched');
    const cyrillic = validateNpiRegistrySearch({
      firstName: "\u0418\u0432\u0430\u043d",
      lastName: "Doe",
    });
    expect(cyrillic.ok).toBe(false);
    const mixed = validateNpiRegistrySearch({ firstName: "Ana", lastName: "Do\u00a7e" });
    expect(!mixed.ok && mixed.error).toContain('"\u00a7"');
  });

  it("rejects a state that is not a US code", () => {
    expect(validateNpiRegistrySearch({ firstName: "A", lastName: "B", state: "XX" }).ok).toBe(
      false,
    );
    expect(validateNpiRegistrySearch({ firstName: "A", lastName: "B", state: 7 }).ok).toBe(false);
    expect(validateNpiRegistrySearch({ firstName: "A", lastName: "B", state: "" })).toMatchObject({
      ok: true,
      value: { state: null },
    });
  });
});

describe("validateNpiRegistryLookup", () => {
  it("accepts a check-digit-valid NPI, dashes and spaces allowed", () => {
    expect(validateNpiRegistryLookup({ npi: "1234567893" })).toEqual({
      ok: true,
      value: "1234567893",
    });
    expect(validateNpiRegistryLookup({ npi: "123-456-7893" })).toEqual({
      ok: true,
      value: "1234567893",
    });
  });

  it("never sends a number that fails the check digit or the shape", () => {
    for (const npi of ["1234567890", "12345", "12345678x3", 1234567893, null]) {
      expect(validateNpiRegistryLookup({ npi }).ok).toBe(false);
    }
    expect(validateNpiRegistryLookup(null).ok).toBe(false);
  });
});

describe("foldNameForRegistry", () => {
  it("removes accents the registry does not store", () => {
    expect(foldNameForRegistry("José Núñez")).toBe("Jose Nunez");
  });

  it("transliterates letters NFD cannot split", () => {
    const cases: Array<[string, string]> = [
      ["\u0141ukasz", "Lukasz"],
      ["S\u00f8ren", "Soren"],
      ["Strau\u00df", "Strauss"],
      ["\u00c6sa", "AEsa"],
      ["\u0110or\u0111e", "Dorde"],
      ["\u00deora", "THora"],
      ["Ca\u011fr\u0131", "Cagri"],
    ];
    for (const [typed, folded] of cases) expect(foldNameForRegistry(typed)).toBe(folded);
  });

  it("straightens curly apostrophes and drops periods and trailing suffixes", () => {
    expect(foldNameForRegistry("O\u2019Brien")).toBe("O'Brien");
    expect(foldNameForRegistry("J.")).toBe("J");
    expect(foldNameForRegistry("St. John")).toBe("St John");
    expect(foldNameForRegistry("Smith, Jr.")).toBe("Smith");
    expect(foldNameForRegistry("King III")).toBe("King");
    expect(foldNameForRegistry("Lee MD")).toBe("Lee");
    // Never the only word.
    expect(foldNameForRegistry("Jr")).toBe("Jr");
  });
});

describe("compareNpiRegistryName", () => {
  it("matches ignoring case, accents, spaces and punctuation", () => {
    expect(compareNpiRegistryName({ firstName: "jane", lastName: "Doe" }, jane)).toBe("match");
    const obrien = { ...jane, firstName: "SEAN", lastName: "OBRIEN" };
    expect(compareNpiRegistryName({ firstName: "Seán", lastName: "O'Brien" }, obrien)).toBe(
      "match",
    );
  });

  it("accepts an initial or short form of the first name", () => {
    const chris = { ...jane, firstName: "CHRISTOPHER" };
    expect(compareNpiRegistryName({ firstName: "Chris", lastName: "Doe" }, chris)).toBe("match");
    expect(compareNpiRegistryName({ firstName: "C", lastName: "Doe" }, chris)).toBe("match");
  });

  it("never matches a longer typed first name against a shorter registry one", () => {
    const cases: Array<[string, string]> = [
      ["Danielle", "DANIEL"],
      ["Josephine", "JOSEPH"],
      ["Paula", "PAUL"],
    ];
    for (const [typedFirst, registryFirst] of cases) {
      const record = { ...jane, firstName: registryFirst, middleName: null };
      expect(compareNpiRegistryName({ firstName: typedFirst, lastName: "Doe" }, record)).toBe(
        "mismatch",
      );
    }
  });

  it("matches a registry initial and a first-plus-middle name", () => {
    const initial = { ...jane, firstName: "J", middleName: null };
    expect(compareNpiRegistryName({ firstName: "Jane", lastName: "Doe" }, initial)).toBe("match");
    const maryAnn = { ...jane, firstName: "MARY", middleName: "ANN" };
    expect(compareNpiRegistryName({ firstName: "Mary Ann", lastName: "Doe" }, maryAnn)).toBe(
      "match",
    );
    expect(compareNpiRegistryName({ firstName: "Mary Beth", lastName: "Doe" }, maryAnn)).toBe(
      "mismatch",
    );
  });

  it("folds transliterated letters, suffixes and periods on both sides", () => {
    const lukasz = { ...jane, firstName: "LUKASZ", lastName: "SMITH" };
    expect(
      compareNpiRegistryName({ firstName: "\u0141ukasz", lastName: "Smith Jr." }, lukasz),
    ).toBe("match");
    expect(compareNpiRegistryName({ firstName: "J.", lastName: "Doe" }, jane)).toBe("match");
  });

  it("matches a former name the registry lists", () => {
    expect(compareNpiRegistryName({ firstName: "Jane", lastName: "Smith" }, jane)).toBe("match");
  });

  it("flags a different last name or first name", () => {
    expect(compareNpiRegistryName({ firstName: "Jane", lastName: "Roe" }, jane)).toBe("mismatch");
    expect(compareNpiRegistryName({ firstName: "Mary", lastName: "Doe" }, jane)).toBe("mismatch");
  });

  it("does not compare until both names are typed", () => {
    expect(compareNpiRegistryName({ firstName: "", lastName: "Doe" }, jane)).toBe("unchecked");
    expect(compareNpiRegistryName({ firstName: "Jane", lastName: " " }, jane)).toBe("unchecked");
  });
});

describe("npiVerificationView", () => {
  const typed = { firstName: "Jane", lastName: "Doe" };

  it("says nothing until there is a checkable NPI", () => {
    expect(npiVerificationView({ status: "idle" }, typed)).toBeNull();
    expect(npiVerificationView({ status: "loading" }, typed)?.tone).toBe("neutral");
  });

  it("confirms a match with the registry summary", () => {
    expect(npiVerificationView({ status: "done", record: jane }, typed)).toEqual({
      tone: "ok",
      title: "Found in the NPI Registry",
      detail: "JANE A DOE, PT, DPT · Physical Therapist · DENVER, CO",
    });
    expect(registrySummary({ ...jane, credential: null, practiceCity: null })).toBe(
      "JANE A DOE · Physical Therapist · CO",
    );
  });

  it("warns, never blocks, on a name mismatch, a miss, an organization or downtime", () => {
    const mismatch = npiVerificationView(
      { status: "done", record: jane },
      { firstName: "Mary", lastName: "Roe" },
    );
    expect(mismatch).toMatchObject({
      tone: "warn",
      title: "Found in the NPI Registry, but the name differs",
    });
    expect(mismatch?.detail).toContain("JANE A DOE");

    const missing = npiVerificationView({ status: "done", record: null }, typed);
    expect(missing).toMatchObject({ tone: "warn", title: "Not found in the NPI Registry" });
    expect(missing?.detail).toContain("You can still save");

    const org = npiVerificationView(
      {
        status: "done",
        record: {
          ...jane,
          enumerationType: "NPI-2",
          organizationName: "DENVER REHAB LLC",
          firstName: null,
          middleName: null,
          lastName: null,
        },
      },
      typed,
    );
    expect(org).toMatchObject({ tone: "warn", title: "This NPI belongs to an organization" });
    expect(org?.detail).toContain("DENVER REHAB LLC");

    const down = npiVerificationView(
      { status: "error", message: NPI_REGISTRY_UNAVAILABLE_MESSAGE },
      typed,
    );
    expect(down).toEqual({
      tone: "warn",
      title: "NPI Registry is unavailable",
      detail: "You can still save this provider.",
    });

    const inactive = npiVerificationView(
      { status: "done", record: { ...jane, status: "inactive" } },
      typed,
    );
    expect(inactive?.title).toBe("The NPI Registry lists this NPI as inactive");
  });

  it("reports a found NPI as found while the form names are still blank", () => {
    expect(
      npiVerificationView({ status: "done", record: jane }, { firstName: "", lastName: "" }),
    ).toMatchObject({ tone: "ok", title: "Found in the NPI Registry" });
  });
});
