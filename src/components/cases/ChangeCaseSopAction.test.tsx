import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CaseDetail } from "@/types";

vi.mock("@/hooks/useCases", () => ({
  useReplaceCaseSop: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string | undefined>;
  }) => {
    const query = new URLSearchParams(
      Object.entries(search ?? {}).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, value]],
      ),
    ).toString();
    return <a href={query ? `${to}?${query}` : to}>{children}</a>;
  },
}));

import { CaseTypeNotice } from "./ChangeCaseSopAction";

const baseCase = {
  id: "case-1",
  payerId: "aetna",
  groupId: "group-1",
  state: "CO",
  caseStatus: "not_started",
  caseType: "enrollment",
} as unknown as CaseDetail;

describe("CaseTypeNotice", () => {
  it("renders nothing for an enrollment case, so no banner sits above the tasks", () => {
    const html = renderToStaticMarkup(<CaseTypeNotice c={baseCase} canEdit />);
    expect(html).toBe("");
  });

  it("keeps the recredentialing notice", () => {
    const c = { ...baseCase, caseType: "recredentialing" } as CaseDetail;
    const html = renderToStaticMarkup(<CaseTypeNotice c={c} canEdit />);
    expect(html).toContain("Recredentialing execution is not supported");
  });

  it("keeps the contract notice with its Matrix link", () => {
    const c = { ...baseCase, caseType: "contract" } as CaseDetail;
    const html = renderToStaticMarkup(<CaseTypeNotice c={c} canEdit />);
    expect(html).toContain("Group Contracts Matrix");
    expect(html).toContain("/reporting/contracts-matrix");
  });

  it("links to the case's specialty table when the provider's taxonomy names one (GCM-20)", () => {
    const c = {
      ...baseCase,
      caseType: "contract",
      provider: { taxonomyCode: "133V00000X" },
    } as unknown as CaseDetail;
    const html = renderToStaticMarkup(<CaseTypeNotice c={c} canEdit />);
    expect(html).toContain(
      "/reporting/contracts-matrix?groupId=group-1&amp;payerId=aetna&amp;state=CO&amp;specialty=nutrition",
    );
  });

  it("leaves the specialty out when the provider's taxonomy names none", () => {
    const c = { ...baseCase, caseType: "contract", provider: null } as unknown as CaseDetail;
    const html = renderToStaticMarkup(<CaseTypeNotice c={c} canEdit />);
    expect(html).toContain(
      '/reporting/contracts-matrix?groupId=group-1&amp;payerId=aetna&amp;state=CO"',
    );
  });

  it("shows nothing to a read-only viewer or on a closed case", () => {
    const c = { ...baseCase, caseType: "contract" } as CaseDetail;
    expect(renderToStaticMarkup(<CaseTypeNotice c={c} canEdit={false} />)).toBe("");
    const closed = { ...c, caseStatus: "approved" } as CaseDetail;
    expect(renderToStaticMarkup(<CaseTypeNotice c={closed} canEdit />)).toBe("");
  });
});
