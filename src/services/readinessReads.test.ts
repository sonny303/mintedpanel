// Readiness + generation source reads at the PostgREST boundary: every
// whole-org input pages past the server's max-rows cap with an id tiebreak,
// keeps its filters on every page, and fails loudly instead of returning a
// short list. Sized to the Luna synthetic org (3,500 providers, 3,320 past
// the readiness fence), where a capped read silently dropped providers from
// readiness AND generation candidacy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/integrations/supabase/externalClient", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient("http://127.0.0.1:1", "synthetic-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (...args) => transport.fetch(...args) },
    }),
  };
});

import { useAuthStore } from "@/lib/auth-store";
import { COMPLETE_READ_PAGE_SIZE } from "@/lib/completePages";
import {
  listGroupInsurancePolicies,
  listGroupReadinessDocuments,
  listProviderReadinessFacts,
} from "./enrollmentReadiness";
import { listCaseGenerationExclusions } from "./caseGenerationExclusions";
import { listGenerationCaseRows, listGenerationContractRows } from "./generationPreview";
import { listOrgStateLicenses } from "./lookups";
import { getProviders, listProviderGroupAssignments } from "./providers";

type Row = Record<string, unknown>;
const SERVER_MAX_ROWS = 1000;
const LUNA_FENCED_PROVIDERS = 3320;

interface RequestCapture {
  table: string;
  url: URL;
  prefer: string;
}

/** Serves fixed rows per table: honors offset/limit, caps a page at the
 * server's max-rows, and answers an exact count in content-range.
 * `reportedTotal` overrides that count to simulate a short delivery. */
function serve(rowsByTable: Record<string, Row[]>, reportedTotal?: number) {
  const requests: RequestCapture[] = [];
  transport.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").at(-1) ?? "";
    const headers = new Headers(init?.headers);
    requests.push({ table, url, prefer: headers.get("prefer") ?? "" });
    const source = rowsByTable[table] ?? [];
    const total = reportedTotal ?? source.length;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Math.min(
      Number(url.searchParams.get("limit") ?? SERVER_MAX_ROWS),
      SERVER_MAX_ROWS,
    );
    const page = source.slice(offset, offset + limit);
    const contentRange =
      page.length === 0 ? `*/${total}` : `${offset}-${offset + page.length - 1}/${total}`;
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json", "content-range": contentRange },
    });
  });
  return requests;
}

const pad = (i: number) => String(i).padStart(5, "0");
const pagesFor = (rows: number) => Math.ceil(rows / COMPLETE_READ_PAGE_SIZE);

function expectEveryPage(
  requests: RequestCapture[],
  params: Record<string, string | string[]>,
): void {
  for (const request of requests) {
    expect(request.prefer).toContain("count=exact");
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) expect(request.url.searchParams.getAll(key)).toEqual(value);
      else expect(request.url.searchParams.get(key)).toBe(value);
    }
  }
}

function providerFactRow(i: number): Row {
  return {
    id: `p${pad(i)}`,
    first_name: "Pat",
    last_name: `Luna ${i}`,
    status: "active",
    verification_state: "verified",
    npi: i % 2 === 0 ? "1234567890" : null,
    caqh_id: i % 3 === 0 ? " " : "CAQH1",
    caqh_last_attested_date: "2026-09-01",
    date_of_birth: "1980-01-01",
    ssn_last4: "1234",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ activeOrgId: "org-1" });
});
afterEach(() => {
  useAuthStore.setState({ activeOrgId: null });
});

describe("listProviderReadinessFacts", () => {
  it("returns every fenced provider at Luna scale, fenced and id-ordered on every page", async () => {
    const requests = serve({
      providers: Array.from({ length: LUNA_FENCED_PROVIDERS }, (_, i) => providerFactRow(i)),
    });
    const facts = await listProviderReadinessFacts();
    expect(facts).toHaveLength(LUNA_FENCED_PROVIDERS);
    expect(new Set(facts.map((f) => f.providerId)).size).toBe(LUNA_FENCED_PROVIDERS);
    expect(requests).toHaveLength(pagesFor(LUNA_FENCED_PROVIDERS));
    expectEveryPage(requests, {
      org_id: "eq.org-1",
      status: "neq.terminated",
      verification_state: "neq.pending_verification",
      is_test_provider: "neq.true",
      order: "id.asc",
    });
  });

  it("reduces demographics to presence booleans — no DOB or SSN value leaves the service", async () => {
    serve({ providers: [providerFactRow(0), providerFactRow(1)] });
    const facts = await listProviderReadinessFacts();
    expect(facts[0]).toEqual({
      providerId: "p00000",
      providerName: "Pat Luna 0",
      npiPresent: true,
      caqhIdPresent: false,
      caqhLastAttestedDate: "2026-09-01",
      dobPresent: true,
      ssnLast4Present: true,
    });
    expect(facts[1]).toMatchObject({ npiPresent: false, caqhIdPresent: true });
    expect(JSON.stringify(facts)).not.toContain("1980-01-01");
    for (const fact of facts) {
      expect(Object.keys(fact)).not.toContain("dateOfBirth");
      expect(Object.keys(fact)).not.toContain("ssnLast4");
    }
  });

  it("throws instead of returning a short list when the server delivers fewer rows than it counted", async () => {
    serve(
      { providers: Array.from({ length: 1200 }, (_, i) => providerFactRow(i)) },
      LUNA_FENCED_PROVIDERS,
    );
    await expect(listProviderReadinessFacts()).rejects.toThrow(
      "Provider readiness facts returned an incomplete page set.",
    );
  });
});

describe("listGroupReadinessDocuments", () => {
  it("pages past the cap and reduces to current versions across page boundaries", async () => {
    const filler = Array.from({ length: 1100 }, (_, i) => ({
      id: `d${pad(i + 1)}`,
      group_id: `g${i}`,
      doc_type: "w9",
      expiration_date: null,
      document_family_id: `fam${i}`,
      version_number: 1,
      supersedes_document_id: null,
    }));
    // v1 lands on page one, its successor v2 on page three: only a complete
    // read sees v2 supersede v1.
    const v1 = {
      id: "d00000",
      group_id: "g-coi",
      doc_type: "coi",
      expiration_date: "2026-01-01",
      document_family_id: "fam-coi",
      version_number: 1,
      supersedes_document_id: null,
    };
    const v2 = { ...v1, id: "d99999", expiration_date: "2027-01-01", version_number: 2 };
    const requests = serve({
      provider_documents: [v1, ...filler, { ...v2, supersedes_document_id: "d00000" }],
    });
    const docs = await listGroupReadinessDocuments();
    expect(docs).toHaveLength(1101);
    expect(docs.filter((d) => d.groupId === "g-coi")).toEqual([
      { groupId: "g-coi", docType: "coi", expirationDate: "2027-01-01" },
    ]);
    expect(requests).toHaveLength(pagesFor(1102));
    expectEveryPage(requests, {
      org_id: "eq.org-1",
      group_id: "not.is.null",
      doc_type: "in.(w9,coi)",
      order: "id.asc",
    });
  });
});

describe("listGroupInsurancePolicies", () => {
  it("returns every policy past the cap", async () => {
    const requests = serve({
      group_insurance_policies: Array.from({ length: 1001 }, (_, i) => ({
        group_id: `g${i}`,
        policy_end_date: "2027-01-01",
      })),
    });
    const policies = await listGroupInsurancePolicies();
    expect(policies).toHaveLength(1001);
    expect(policies[0]).toEqual({ groupId: "g0", policyEndDate: "2027-01-01" });
    expect(requests).toHaveLength(pagesFor(1001));
    expectEveryPage(requests, {
      org_id: "eq.org-1",
      select: "group_id,policy_end_date",
      order: "id.asc",
    });
  });
});

describe("generation-path whole-org reads", () => {
  it("listProviderGroupAssignments returns the full group roster", async () => {
    const requests = serve({
      provider_group_assignments: Array.from({ length: 3500 }, (_, i) => ({
        id: `a${pad(i)}`,
        provider_id: `p${pad(i)}`,
        group_id: "g1",
        is_primary: true,
      })),
    });
    const rows = await listProviderGroupAssignments();
    expect(rows).toHaveLength(3500);
    expect(rows[3499]).toMatchObject({ providerId: "p03499", groupId: "g1", isPrimary: true });
    expect(requests).toHaveLength(pagesFor(3500));
    expectEveryPage(requests, { org_id: "eq.org-1", order: "id.asc" });
  });

  it("listOrgStateLicenses returns every license feeding the footprint", async () => {
    const requests = serve({
      state_licenses: Array.from({ length: 1500 }, (_, i) => ({
        id: `l${pad(i)}`,
        provider_id: `p${pad(i)}`,
        state: "TX",
        license_number: null,
        issue_date: null,
        expiration_date: "2027-01-01",
        verified_status: "verified",
      })),
    });
    expect(await listOrgStateLicenses()).toHaveLength(1500);
    expect(requests).toHaveLength(pagesFor(1500));
    expectEveryPage(requests, { org_id: "eq.org-1", order: "id.asc" });
  });

  it("listGenerationCaseRows returns every existing case, group key normalized to null", async () => {
    const requests = serve({
      credential_cases: Array.from({ length: 1001 }, (_, i) => ({
        id: `c${pad(i)}`,
        provider_id: `p${i}`,
        payer_id: "py1",
        state: "TX",
        credentialing_status_id: null,
        ...(i === 1000 ? {} : { group_id: "g1" }),
      })),
    });
    const rows = await listGenerationCaseRows();
    expect(rows).toHaveLength(1001);
    expect(rows[1000].groupId).toBeNull();
    expect(requests).toHaveLength(pagesFor(1001));
    expectEveryPage(requests, { org_id: "eq.org-1", order: "id.asc" });
  });

  it("listGenerationContractRows returns every contract", async () => {
    const requests = serve({
      contracts: Array.from({ length: 1001 }, (_, i) => ({
        group_id: "g1",
        payer_id: `py${i}`,
        state: "TX",
        contracting_status_id: null,
      })),
    });
    expect(await listGenerationContractRows()).toHaveLength(1001);
    expectEveryPage(requests, { org_id: "eq.org-1", order: "id.asc" });
  });

  it("listCaseGenerationExclusions returns every exclusion, oldest first with an id tiebreak", async () => {
    const requests = serve({
      case_generation_exclusions: Array.from({ length: 1001 }, (_, i) => ({
        id: `x${pad(i)}`,
        provider_id: `p${i}`,
        created_at: "2026-09-01T00:00:00Z",
      })),
    });
    expect(await listCaseGenerationExclusions()).toHaveLength(1001);
    expectEveryPage(requests, { org_id: "eq.org-1", order: "created_at.asc,id.asc" });
  });

  it("getProviders returns the whole roster, sorted with an id tiebreak", async () => {
    const requests = serve({
      providers: Array.from({ length: 3500 }, (_, i) => ({
        id: `p${pad(i)}`,
        first_name: "Pat",
        last_name: "Luna",
        status: "active",
      })),
    });
    const rows = await getProviders({ excludeStatus: "terminated" });
    expect(rows).toHaveLength(3500);
    expect(requests).toHaveLength(pagesFor(3500));
    expectEveryPage(requests, {
      org_id: "eq.org-1",
      status: "neq.terminated",
      order: "last_name.asc,id.asc",
    });
  });
});
