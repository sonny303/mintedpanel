import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useTouches", () => ({
  useBulkLogTouch: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useCases", () => ({
  useSetCaseStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { AddTouchDialog, type TouchCaseCandidate } from "./AddTouchDialog";

const CANDIDATES: TouchCaseCandidate[] = [
  { id: "case-a", label: "Dana Whitley · NC · Anthem", currentStatus: "submitted" },
  { id: "case-b", label: "Dana Whitley · SC · Anthem", currentStatus: "in_progress" },
];

function render(
  candidates: TouchCaseCandidate[],
  opts: { defaultSelectedIds?: string[]; loading?: boolean; failed?: boolean } = {},
) {
  return renderToStaticMarkup(
    <AddTouchDialog open candidates={candidates} onClose={() => undefined} {...opts} />,
  );
}

/** The opening tag of the button whose label is exactly `label`. */
function buttonTag(html: string, label: string): string | undefined {
  return html
    .split("<button")
    .find((chunk) => chunk.includes(`>${label}</button>`))
    ?.split(">")[0];
}

describe("AddTouchDialog (MINT-92)", () => {
  it("with zero open cases shows only the message and Close: no form, no Save", () => {
    const html = render([]);
    expect(html).toContain("No open cases to log against.");
    expect(buttonTag(html, "Close")).toBeDefined();
    expect(html).not.toContain("Save touch");
    expect(html).not.toContain("Recipient");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
  });

  it("with cases but none selected disables Save and says why beside it", () => {
    const html = render(CANDIDATES);
    expect(html).toContain("Cases (0 selected)");
    const hintId = html.match(/<p id="([^"]+)"[^>]*>Select at least one case<\/p>/)?.[1];
    expect(hintId).toBeDefined();
    const save = buttonTag(html, "Save touch");
    expect(save).toMatch(/\sdisabled=""/);
    expect(save).toContain(`aria-describedby="${hintId}"`);
  });

  it("enables Save and drops the hint once a case is selected", () => {
    const html = render(CANDIDATES, { defaultSelectedIds: ["case-a"] });
    expect(html).toContain("Cases (1 selected)");
    expect(html).not.toContain("Select at least one case");
    const save = buttonTag(html, "Save touch");
    expect(save).not.toMatch(/\sdisabled=""/);
    expect(save).not.toContain("aria-describedby");
  });

  it("while the cases load says so instead of claiming there are none", () => {
    const html = render([], { loading: true });
    expect(html).toContain("Loading cases…");
    expect(html).not.toContain("No open cases");
    expect(html).not.toContain("Save touch");
    expect(buttonTag(html, "Close")).toBeDefined();
  });

  it("after a failed load reports the failure, never an empty list", () => {
    const html = render([], { loading: true, failed: true });
    expect(html).toContain("load cases. Refresh to retry.");
    expect(html).not.toContain("No open cases");
    expect(html).not.toContain("Loading cases");
    expect(html).not.toContain("Save touch");
  });
});
