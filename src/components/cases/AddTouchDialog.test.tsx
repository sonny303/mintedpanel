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

function render(candidates: TouchCaseCandidate[], defaultSelectedIds?: string[]) {
  return renderToStaticMarkup(
    <AddTouchDialog
      open
      candidates={candidates}
      defaultSelectedIds={defaultSelectedIds}
      onClose={() => undefined}
    />,
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
    expect(html).toContain("Select at least one case");
    expect(buttonTag(html, "Save touch")).toMatch(/\sdisabled=""/);
  });

  it("enables Save and drops the hint once a case is selected", () => {
    const html = render(CANDIDATES, ["case-a"]);
    expect(html).toContain("Cases (1 selected)");
    expect(html).not.toContain("Select at least one case");
    expect(buttonTag(html, "Save touch")).not.toMatch(/\sdisabled=""/);
  });
});
