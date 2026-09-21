import { describe, it, expect } from "vitest";
import {
  FORBIDDEN_SEARCH_COLUMNS,
  GLOBAL_PROVIDER_SEARCH_COLUMNS,
  MIN_SEARCH_LENGTH,
  buildProviderSearchFilter,
  mapProviderSearchRows,
  npiQueryDigits,
  rankProviderHits,
  restrictToAuthorizedOrgs,
  sanitizeSearchTerm,
  type GlobalProviderHit,
} from "./globalSearch";

function hit(over: Partial<GlobalProviderHit> = {}): GlobalProviderHit {
  return {
    providerId: "p-1",
    orgId: "org-1",
    orgName: "Kansas PT",
    name: "Jane Smith",
    firstName: "Jane",
    lastName: "Smith",
    credentials: "PT, DPT",
    npi: "1234567890",
    status: "active",
    ...over,
  };
}

describe("sanitizeSearchTerm", () => {
  it("lowercases, collapses whitespace, and trims", () => {
    expect(sanitizeSearchTerm("  Jane   SMITH  ")).toBe("jane smith");
  });

  it("strips the characters PostgREST treats as filter structure", () => {
    // A raw term carrying these either breaks or widens the or= filter.
    expect(sanitizeSearchTerm("smith,npi.not.is.null")).toBe("smith npi not is null");
    expect(sanitizeSearchTerm("a(b)c")).toBe("a b c");
    expect(sanitizeSearchTerm('say "hi"')).toBe("say hi");
    expect(sanitizeSearchTerm("back\\slash")).toBe("back slash");
  });

  it("strips ILIKE wildcards so a term can never match more than it says", () => {
    expect(sanitizeSearchTerm("%")).toBe("");
    expect(sanitizeSearchTerm("sm%th")).toBe("sm th");
    expect(sanitizeSearchTerm("sm_th")).toBe("sm th");
    expect(sanitizeSearchTerm("*")).toBe("");
  });

  it("keeps hyphens, which are ordinary in surnames", () => {
    expect(sanitizeSearchTerm("Ortiz-Vega")).toBe("ortiz-vega");
  });

  it("caps runaway input", () => {
    expect(sanitizeSearchTerm("a".repeat(500))).toHaveLength(60);
  });
});

describe("npiQueryDigits", () => {
  it("treats a run of digits as an NPI query", () => {
    expect(npiQueryDigits("1234567890")).toBe("1234567890");
    expect(npiQueryDigits("123")).toBe("123");
    expect(npiQueryDigits("123 456")).toBe("123456");
    expect(npiQueryDigits("123-456")).toBe("123456");
  });

  it("is not an NPI query for short digits, mixed text, or a name", () => {
    expect(npiQueryDigits("12")).toBeNull();
    expect(npiQueryDigits("smith")).toBeNull();
    expect(npiQueryDigits("1234abc")).toBeNull();
    expect(npiQueryDigits("12345678901")).toBeNull();
  });
});

describe("buildProviderSearchFilter", () => {
  it("returns null below the minimum length, so no query is issued", () => {
    expect(buildProviderSearchFilter("")).toBeNull();
    expect(buildProviderSearchFilter("a")).toBeNull();
    expect(MIN_SEARCH_LENGTH).toBe(2);
  });

  it("searches the NPI column only for a digit term, as a prefix", () => {
    expect(buildProviderSearchFilter("1234567890")).toBe("npi.ilike.1234567890%");
  });

  it("searches both name columns and the NPI for a single word", () => {
    expect(buildProviderSearchFilter("smith")).toBe(
      "first_name.ilike.%smith%,last_name.ilike.%smith%,npi.ilike.%smith%",
    );
  });

  it("matches a two-word term in either name order", () => {
    const filter = buildProviderSearchFilter("jane smith");
    expect(filter).toContain("and(first_name.ilike.%jane%,last_name.ilike.%smith%)");
    expect(filter).toContain("and(first_name.ilike.%smith%,last_name.ilike.%jane%)");
  });

  it("never emits an org filter — RLS owns that, and naming an org here would narrow the search", () => {
    expect(buildProviderSearchFilter("smith")).not.toContain("org_id");
  });
});

describe("GLOBAL_PROVIDER_SEARCH_COLUMNS", () => {
  it("carries only the lookup fields, and no PHI column", () => {
    for (const column of FORBIDDEN_SEARCH_COLUMNS) {
      expect(GLOBAL_PROVIDER_SEARCH_COLUMNS).not.toContain(column);
    }
    expect(GLOBAL_PROVIDER_SEARCH_COLUMNS).not.toContain("*");
  });
});

describe("mapProviderSearchRows", () => {
  it("projects a raw row, resolving the embedded org name", () => {
    expect(
      mapProviderSearchRows([
        {
          id: "p-1",
          org_id: "org-1",
          first_name: "Jane",
          last_name: "Smith",
          credentials: "PT, DPT",
          npi: "1234567890",
          status: "active",
          organizations: { name: "Kansas PT" },
        },
      ]),
    ).toEqual([hit()]);
  });

  it("drops rows with no id or no org, rather than rendering an unattributable result", () => {
    expect(
      mapProviderSearchRows([
        { id: "", org_id: "org-1", first_name: "A", last_name: "B" },
        { id: "p-2", org_id: "", first_name: "A", last_name: "B" },
        null,
        "nonsense",
      ]),
    ).toEqual([]);
  });

  it("normalizes blank optional fields to null and a missing org embed to an empty name", () => {
    const [row] = mapProviderSearchRows([
      {
        id: "p-3",
        org_id: "org-9",
        first_name: "Ann",
        last_name: "Lee",
        credentials: "  ",
        npi: "",
        status: "active",
        organizations: null,
      },
    ]);
    expect(row.credentials).toBeNull();
    expect(row.npi).toBeNull();
    expect(row.orgName).toBe("");
  });
});

describe("restrictToAuthorizedOrgs", () => {
  const authorized = new Map([
    ["org-1", "Kansas PT"],
    ["org-2", "Missouri Rehab"],
  ]);

  it("keeps hits from every org the caller is a member of", () => {
    const hits = [hit({ orgId: "org-1" }), hit({ providerId: "p-2", orgId: "org-2" })];
    expect(restrictToAuthorizedOrgs(hits, authorized).map((h) => h.orgId)).toEqual([
      "org-1",
      "org-2",
    ]);
  });

  it("drops a hit from an org the caller is not a member of", () => {
    // Unreachable through RLS; asserted so a policy regression reads as a
    // missing row in the palette rather than a leaked one.
    const hits = [hit({ providerId: "p-x", orgId: "org-foreign" })];
    expect(restrictToAuthorizedOrgs(hits, authorized)).toEqual([]);
  });

  it("returns nothing when the caller has no memberships", () => {
    expect(restrictToAuthorizedOrgs([hit()], new Map())).toEqual([]);
  });

  it("prefers the caller's own membership name over the embedded one", () => {
    const hits = [hit({ orgId: "org-2", orgName: "stale name" })];
    expect(restrictToAuthorizedOrgs(hits, authorized)[0].orgName).toBe("Missouri Rehab");
  });
});

describe("rankProviderHits", () => {
  it("puts a last-name prefix above a first-name prefix above a bare substring", () => {
    const hits = [
      hit({ providerId: "sub", firstName: "Ola", lastName: "Wasmith" }),
      hit({ providerId: "first", firstName: "Smitty", lastName: "Jones" }),
      hit({ providerId: "last", firstName: "Jane", lastName: "Smith" }),
    ];
    expect(rankProviderHits(hits, "smit").map((h) => h.providerId)).toEqual([
      "last",
      "first",
      "sub",
    ]);
  });

  it("puts an exact NPI first and keeps prefix matches behind it", () => {
    const hits = [
      hit({ providerId: "prefix", npi: "1234567899" }),
      hit({ providerId: "exact", npi: "1234567890" }),
    ];
    expect(rankProviderHits(hits, "1234567890").map((h) => h.providerId)).toEqual([
      "exact",
      "prefix",
    ]);
  });

  it("sorts terminated providers last without dropping them", () => {
    const hits = [
      hit({ providerId: "gone", lastName: "Smith", status: "terminated" }),
      hit({ providerId: "here", lastName: "Smithers", status: "active" }),
    ];
    expect(rankProviderHits(hits, "smith").map((h) => h.providerId)).toEqual(["here", "gone"]);
  });

  it("breaks ties deterministically, so the top row does not jitter", () => {
    const hits = [
      hit({ providerId: "b", firstName: "Ann", lastName: "Smith", orgName: "Zed Health" }),
      hit({ providerId: "a", firstName: "Ann", lastName: "Smith", orgName: "Acme Health" }),
    ];
    const once = rankProviderHits(hits, "smith").map((h) => h.providerId);
    const twice = rankProviderHits([...hits].reverse(), "smith").map((h) => h.providerId);
    expect(once).toEqual(["a", "b"]);
    expect(twice).toEqual(once);
  });

  it("caps the result set", () => {
    const hits = Array.from({ length: 30 }, (_, i) =>
      hit({ providerId: `p-${i}`, lastName: `Smith${i}` }),
    );
    expect(rankProviderHits(hits, "smith")).toHaveLength(8);
    expect(rankProviderHits(hits, "smith", 3)).toHaveLength(3);
  });

  it("ranks the same provider once per org they appear in", () => {
    // A locum working for two of the caller's groups is two provider rows in
    // two orgs; both must surface, because "which org" is half the answer.
    const hits = [
      hit({ providerId: "p-ks", orgId: "org-1", orgName: "Kansas PT" }),
      hit({ providerId: "p-mo", orgId: "org-2", orgName: "Missouri Rehab" }),
    ];
    expect(rankProviderHits(hits, "smith")).toHaveLength(2);
  });
});
