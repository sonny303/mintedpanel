import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SopTemplateDraft } from "@/types";

const draftsState = vi.hoisted(() => ({
  data: [] as SopTemplateDraft[],
  isError: false,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string | undefined>;
    "aria-label"?: string;
  }) => {
    const query = new URLSearchParams(
      Object.entries(search ?? {}).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, value]],
      ),
    ).toString();
    return (
      <a href={query ? `${to}?${query}` : to} aria-label={rest["aria-label"]}>
        {children}
      </a>
    );
  },
}));
vi.mock("@/hooks/useSopTemplateDrafts", () => ({
  useSopTemplateDrafts: () => ({
    data: draftsState.data,
    isError: draftsState.isError,
    refetch: vi.fn(),
  }),
  useDeleteSopTemplateDraft: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

import { PayerTemplateDrafts } from "./PayerTemplateDrafts";

const PAYER_ID = "00000000-0000-4000-a000-0000000000aa";

function draft(over: Partial<SopTemplateDraft> = {}): SopTemplateDraft {
  return {
    id: "55555555-5555-4555-8555-000000000001",
    orgId: "org-1",
    templateId: null,
    payload: { name: "Aetna CO contract", payerId: PAYER_ID },
    updatedBy: "user-1",
    updatedByName: "Owner Dillon",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T12:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  draftsState.data = [];
  draftsState.isError = false;
});

describe("PayerTemplateDrafts", () => {
  it("renders nothing when the payer has no drafts", () => {
    draftsState.data = [draft({ payload: { name: "Cigna", payerId: "other-payer" } })];
    expect(renderToStaticMarkup(<PayerTemplateDrafts payerId={PAYER_ID} />)).toBe("");
  });

  it("lists the draft with its last-saved line and a Resume link to the editor", () => {
    draftsState.data = [draft()];
    const html = renderToStaticMarkup(<PayerTemplateDrafts payerId={PAYER_ID} />);

    expect(html).toContain(">Drafts</h3>");
    expect(html).toContain("Aetna CO contract");
    expect(html).toContain("Last saved Oct 2, 2026");
    expect(html).toContain("by Owner Dillon");
    expect(html).toContain(
      `href="/admin/templates/new?payerId=${PAYER_ID}&amp;tier=global&amp;draftId=55555555-5555-4555-8555-000000000001"`,
    );
    expect(html).toContain('aria-label="Resume Aetna CO contract"');
    expect(html).toContain('aria-label="Discard Aetna CO contract"');
  });

  it("names an unnamed draft with the fallback label", () => {
    draftsState.data = [draft({ payload: { name: "", payerId: PAYER_ID } })];
    const html = renderToStaticMarkup(<PayerTemplateDrafts payerId={PAYER_ID} />);
    expect(html).toContain("Untitled draft");
  });

  it("says so when drafts fail to load instead of hiding them silently", () => {
    draftsState.isError = true;
    const html = renderToStaticMarkup(<PayerTemplateDrafts payerId={PAYER_ID} />);
    expect(html).toContain("load saved drafts");
    expect(html).toContain("Retry");
  });
});
