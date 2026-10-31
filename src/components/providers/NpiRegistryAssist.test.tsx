// MINT-110 — the registry help under an NPI field: what it checks, what it
// says, and that the result list is announced and keyboard-reachable. The
// hooks are mocked; the route and the registry are not reached.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NpiRegistryRecord, NpiRegistrySearchResult } from "@/lib/npiRegistry";

const lookupResult = vi.hoisted(() => ({
  current: {} as {
    data?: { record: unknown };
    isError?: boolean;
    error?: unknown;
  },
}));

vi.mock("@/hooks/useNpiRegistry", () => ({
  useNpiRegistryLookup: vi.fn(() => lookupResult.current),
  useNpiRegistrySearch: vi.fn(() => ({})),
  usePrimeNpiRegistryLookup: vi.fn(() => () => undefined),
}));
vi.mock("@/hooks/useLookups", () => ({
  useFacilities: () => ({ data: [] }),
  useProviderGroups: () => ({ data: [] }),
}));

import { useNpiRegistryLookup } from "@/hooks/useNpiRegistry";
import { CredentialsSection } from "./ProviderFormSections";
import { emptyProviderFormState } from "./providerFormShared";
import {
  NpiRegistryAssist,
  NpiRegistryResultList,
  NpiVerificationNotice,
} from "./NpiRegistryAssist";
import { npiSearchStatusText } from "@/lib/npiRegistry";

const jane: NpiRegistryRecord = {
  npi: "1234567893",
  enumerationType: "NPI-1",
  firstName: "JANE",
  middleName: null,
  lastName: "DOE",
  organizationName: null,
  credential: "PT",
  primaryTaxonomy: { code: "225100000X", description: "Physical Therapist" },
  practiceCity: "DENVER",
  practiceState: "CO",
  status: "active",
  enumerationDate: "2015-03-02",
  otherNames: [],
};

const lookupMock = vi.mocked(useNpiRegistryLookup);

function renderAssist(props: Partial<Parameters<typeof NpiRegistryAssist>[0]> = {}) {
  return renderToStaticMarkup(
    <NpiRegistryAssist
      npi="1234567893"
      firstName="Jane"
      lastName="Doe"
      verify
      onPick={() => undefined}
      {...props}
    />,
  );
}

beforeEach(() => {
  lookupResult.current = {};
  lookupMock.mockClear();
});

describe("NpiRegistryAssist verification", () => {
  it("checks a check-digit-valid NPI and confirms a match", () => {
    lookupResult.current = { data: { record: jane } };
    const html = renderAssist();
    expect(lookupMock).toHaveBeenCalledWith("1234567893");
    expect(html).toContain("Found in the NPI Registry");
    expect(html).toContain("JANE DOE, PT · Physical Therapist · DENVER, CO");
  });

  it("never asks the registry about a blank, malformed or wrong-check-digit NPI", () => {
    for (const npi of ["", "12345", "1234567890", "12345678x3"]) {
      lookupMock.mockClear();
      renderAssist({ npi });
      expect(lookupMock).toHaveBeenCalledWith(null);
    }
  });

  it("does not re-check an unchanged stored NPI", () => {
    renderAssist({ verify: false });
    expect(lookupMock).toHaveBeenCalledWith(null);
  });

  it("warns on a different name and says saving still works when the registry is down", () => {
    lookupResult.current = { data: { record: jane } };
    expect(renderAssist({ firstName: "Mary", lastName: "Roe" })).toContain(
      "Found in the NPI Registry, but the name differs",
    );
    lookupResult.current = { isError: true, error: new Error("NPI Registry is unavailable") };
    const down = renderAssist();
    expect(down).toContain("NPI Registry is unavailable");
    expect(down).toContain("You can still save this provider.");
  });

  it("passes the rate-limit message through and reads any other failure as unavailable", () => {
    lookupResult.current = {
      isError: true,
      error: new Error("Too many NPI Registry lookups — wait a minute and try again"),
    };
    expect(renderAssist()).toContain("Too many NPI Registry lookups");
    lookupResult.current = { isError: true, error: new Error("Invalid or expired token") };
    const expired = renderAssist();
    expect(expired).not.toContain("Invalid or expired token");
    expect(expired).toContain("NPI Registry is unavailable");
  });

  it("keeps the verification line in a mounted polite live region", () => {
    const idle = renderToStaticMarkup(<NpiVerificationNotice view={null} />);
    expect(idle).toBe('<div role="status" aria-live="polite" class="text-[12px]"></div>');
  });
});

describe("NpiRegistryAssist search", () => {
  it("disables Search until both names are typed", () => {
    const blank = renderAssist({ firstName: "", lastName: "Doe" });
    expect(blank).toMatch(/<button[^>]*disabled=""[^>]*>.*Search NPI Registry/);
    expect(blank).toContain("Enter a first and last name to search by name.");
    const ready = renderAssist();
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>.*Search NPI Registry/);
  });

  it("labels the optional state picker", () => {
    expect(renderAssist()).toContain("NPI Registry search state");
  });

  it("announces the result count and when the list was cut short", () => {
    const result = (count: number, truncated = false): NpiRegistrySearchResult => ({
      results: Array.from({ length: count }, () => jane),
      truncated,
    });
    expect(npiSearchStatusText({ status: "idle" })).toBe("");
    expect(npiSearchStatusText({ status: "loading" })).toBe("Searching the NPI Registry…");
    expect(npiSearchStatusText({ status: "done", result: result(0) })).toBe(
      "No individuals in the NPI Registry match that name.",
    );
    expect(npiSearchStatusText({ status: "done", result: result(1) })).toBe(
      "1 match in the NPI Registry. Pick one to fill the NPI.",
    );
    expect(npiSearchStatusText({ status: "done", result: result(10, true) })).toBe(
      "10 matches in the NPI Registry — showing the first 10. Add a state to narrow it.",
    );
    expect(npiSearchStatusText({ status: "error", message: "NPI Registry is unavailable" })).toBe(
      "NPI Registry is unavailable. You can still type the NPI.",
    );
  });

  it("renders each match as a named button in a labelled list", () => {
    const html = renderToStaticMarkup(
      <NpiRegistryResultList results={[jane]} onPick={() => undefined} />,
    );
    expect(html).toContain('<ul aria-label="NPI Registry matches"');
    expect(html).toContain(
      'aria-label="Use NPI 1234567893 — JANE DOE, PT, Physical Therapist, DENVER, CO"',
    );
    expect(html).toContain('type="button"');
    expect(renderToStaticMarkup(<NpiRegistryResultList results={[]} onPick={() => 0} />)).toBe("");
  });
});

describe("Add Provider credentials step", () => {
  it("shows the registry help under the NPI and accepts a pasted dashed NPI", () => {
    const html = renderToStaticMarkup(
      <CredentialsSection
        form={{ ...emptyProviderFormState, firstName: "Jane", lastName: "Doe", npi: "" }}
        errors={{}}
        update={() => undefined}
      />,
    );
    expect(html).toContain("Search NPI Registry");
    // A 10-character cap would cut "123-456-7893" to "123-456-78" before the
    // dashes are stripped.
    expect(html).not.toContain('maxLength="10"');
    expect(html).toContain('maxLength="20"');
  });
});
