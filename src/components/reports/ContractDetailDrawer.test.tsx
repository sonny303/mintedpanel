import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Contract } from "@/types";
import {
  alsoApplySplitsShared,
  contractCoversExplanation,
  contractCoversMode,
  contractSaveSplitsShared,
  planContractSaves,
  type AlsoApplyTarget,
  type ContractDraft,
} from "./contractDetailPlan";

const permissions = vi.hoisted(() => ({ canWrite: true }));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: {},
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="dialog-content" className={className}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useContracts", () => ({
  useUpsertContract: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useStatusConfigs: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/lib/auth-store", () => ({
  useActiveOrgId: () => "mock-org-id",
}));

vi.mock("@/lib/permissions", () => ({
  useCanWrite: () => permissions.canWrite,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isPending: false, isError: false }),
}));

vi.mock("@/components/reports/ContractSopAssignmentPanel", () => ({
  ContractSopAssignmentPanel: () => <div data-testid="mock-sop-panel">Contract SOP Panel</div>,
}));

import { ContractDetailDrawer } from "./ContractDetailDrawer";

function contract(extra: Partial<Contract> = {}): Contract {
  return {
    id: "contract-1",
    orgId: "mock-org-id",
    groupId: "group-1",
    payerId: "payer-1",
    state: "KS",
    effectiveDate: "2026-03-01",
    tentativeEffectiveDate: null,
    expirationDate: null,
    notes: null,
    contractingStatusId: "status-in-network",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

type DrawerProps = Parameters<typeof ContractDetailDrawer>[0];

function render(props: Partial<DrawerProps> = {}): string {
  return renderToStaticMarkup(
    <ContractDetailDrawer
      open={true}
      onClose={vi.fn()}
      contract={contract()}
      groupId="group-1"
      payerId="payer-1"
      state="KS"
      groupName="Group Name 2"
      groupTin="00-0000002"
      payerName="Payer 1"
      {...props}
    />,
  );
}

function radio(
  html: string,
  label: string,
): { checked: boolean; disabled: boolean; tabIndex: string | null } | null {
  const match = html.match(new RegExp(`<button([^>]*role="radio"[^>]*)>${label}</button>`));
  if (!match) return null;
  return {
    checked: match[1].includes('aria-checked="true"'),
    disabled: /\sdisabled=""/.test(match[1]),
    tabIndex: match[1].match(/tabindex="(-?\d+)"/i)?.[1] ?? null,
  };
}

beforeEach(() => {
  permissions.canWrite = true;
});

describe("ContractDetailDrawer", () => {
  it("scrolls when content overflows and keeps the payer — state title", () => {
    const html = render({ groupName: "Colorado Fitness Physio, PLLC", payerName: "Aetna" });
    expect(html).toContain("max-h-[90vh]");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("Aetna — KS");
    expect(html).toContain("Save contract");
  });

  it("names the group with its TIN and the specialty table it was opened from (GCM-9)", () => {
    const html = render({ specialty: "nutrition" });
    expect(html).toContain("Group Name 2 · TIN 00-0000002");
    expect(html).toContain("Group contract · Nutrition table");
  });

  it("no longer offers the free-text Specialty field", () => {
    const html = render({ specialty: "pt" });
    expect(html).not.toContain("e.g. Physical Therapy");
    expect(html).not.toContain("Multi-specialty");
  });

  it("opens a shared record as All specialties and explains where else it shows (GCM-32)", () => {
    const html = render({
      specialty: "nutrition",
      contract: contract({ specialtyKey: "all" }),
      sharedIn: ["pt", "nutrition"],
    });
    expect(radio(html, "All specialties")).toEqual({
      checked: true,
      disabled: false,
      tabIndex: "0",
    });
    expect(radio(html, "Nutrition only")).toEqual({
      checked: false,
      disabled: false,
      tabIndex: "-1",
    });
    expect(html).toContain("so it also shows in the Physical therapy table");
    expect(html).toContain("Choose Nutrition only to record Nutrition separately");
    expect(html).toContain('data-testid="mock-sop-panel"');
  });

  it("does not claim a shared record shows in a table that does not show it", () => {
    const html = render({
      specialty: "nutrition",
      contract: contract({ specialtyKey: "all" }),
      sharedIn: ["nutrition"],
    });
    expect(html).not.toContain("also shows in");
    expect(html).toContain(
      "This agreement covers every specialty of Group Name 2 in KS. Saving changes it for every specialty.",
    );
  });

  it("shows a specialty's own record as read-only Covers", () => {
    const html = render({
      specialty: "nutrition",
      contract: contract({ specialtyKey: "nutrition" }),
    });
    expect(html).not.toContain('role="radiogroup"');
    expect(html).toContain('data-testid="contract-covers-value">Nutrition only<');
  });

  it("defaults a new record to the table's specialty (D13)", () => {
    const html = render({ specialty: "pt", contract: null });
    expect(radio(html, "Physical therapy only")).toEqual({
      checked: true,
      disabled: false,
      tabIndex: "0",
    });
    expect(radio(html, "All specialties")).toEqual({
      checked: false,
      disabled: false,
      tabIndex: "-1",
    });
  });

  it("does not let a new record become All specialties when one already exists", () => {
    const html = render({ specialty: "pt", contract: null, allRecordExists: true });
    expect(radio(html, "All specialties")).toEqual({
      checked: false,
      disabled: true,
      tabIndex: "-1",
    });
  });

  it("offers to apply the status and dates to the payer's other states (GCM-27)", () => {
    const html = render({
      specialty: "pt",
      state: "MO",
      groupName: "Group Name 1",
      alsoApplyTargets: [
        { state: "KS", current: "empty" },
        { state: "MO", current: "own" },
      ],
    });
    expect(html).toContain("Also apply this status and these dates to KS for Group Name 1<");
  });

  it("says when Also apply would record the specialty separately in a shared state", () => {
    const html = render({
      specialty: "pt",
      state: "MO",
      groupName: "Group Name 1",
      contract: contract({ specialtyKey: "pt", state: "MO" }),
      alsoApplyTargets: [{ state: "KS", current: "shared" }],
    });
    expect(html).toContain(
      "Also apply this status and these dates to KS for Group Name 1 (records Physical therapy separately)",
    );
  });

  it("lists one checkbox per state when the payer serves several other states", () => {
    const html = render({
      specialty: "pt",
      state: "MO",
      alsoApplyTargets: [
        { state: "NE", current: "empty" },
        { state: "KS", current: "own" },
      ],
    });
    expect(html).toContain("Also apply this status and these dates for Group Name 2 to:");
    expect(html.indexOf(">KS<")).toBeLessThan(html.indexOf(">NE<"));
  });

  it("opens read-only for billing users: disabled fields, a View only line and only Close (GCM-10)", () => {
    permissions.canWrite = false;
    const html = render({
      specialty: "nutrition",
      contract: contract({ specialtyKey: "all", notes: "Loads after Medicare." }),
      alsoApplyTargets: [{ state: "MO", current: "empty" }],
    });
    expect(html).toContain(
      "View only. Billing users can see contract details but not change them.",
    );
    expect(html).toContain(">Close<");
    expect(html).not.toContain("Save contract");
    expect(html).not.toContain(">Cancel<");
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain("Also apply");
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    expect(html).toMatch(/<input[^>]*id="contract-effective-date"[^>]*disabled=""/);
    expect(html).toMatch(/<fieldset disabled=""/);
  });
});

describe("contract dialog plan", () => {
  it("chooses the Covers mode from the record and the table", () => {
    expect(
      contractCoversMode({ specialty: undefined, contract: null, allRecordExists: false }),
    ).toEqual({ kind: "none", key: "all" });
    expect(
      contractCoversMode({
        specialty: "pt",
        contract: { specialtyKey: "pt" },
        allRecordExists: true,
      }),
    ).toEqual({ kind: "fixed", key: "pt" });
    expect(
      contractCoversMode({
        specialty: "pt",
        contract: { specialtyKey: null },
        allRecordExists: true,
      }),
    ).toEqual({ kind: "choice", specialty: "pt", initial: "all", allowAll: true, shared: true });
    expect(
      contractCoversMode({ specialty: "nutrition", contract: null, allRecordExists: false }),
    ).toEqual({
      kind: "choice",
      specialty: "nutrition",
      initial: "nutrition",
      allowAll: true,
      shared: false,
    });
  });

  it("explains that a specialty-only save leaves the shared agreement alone", () => {
    const mode = contractCoversMode({
      specialty: "nutrition",
      contract: { specialtyKey: "all" },
      allRecordExists: true,
    });
    expect(
      contractCoversExplanation({
        mode,
        selected: "nutrition",
        groupName: "Group Name 2",
        state: "KS",
        sharedElsewhere: ["pt"],
      }),
    ).toBe(
      "Saving creates a separate Nutrition record with these details. Physical therapy keeps the shared agreement, unchanged.",
    );
  });

  it("splits a shared record only when Specialty only is chosen on it", () => {
    const shared = contractCoversMode({
      specialty: "pt",
      contract: { specialtyKey: "all" },
      allRecordExists: true,
    });
    const fresh = contractCoversMode({ specialty: "pt", contract: null, allRecordExists: false });
    expect(contractSaveSplitsShared(shared, "pt")).toBe(true);
    expect(contractSaveSplitsShared(shared, "all")).toBe(false);
    expect(contractSaveSplitsShared(fresh, "pt")).toBe(false);
  });

  const DRAFT: ContractDraft = {
    contractingStatusId: "st-signed",
    tentativeEffectiveDate: "2026-12-01",
    effectiveDate: null,
    expirationDate: null,
    notes: "One agreement covers KS and MO.",
  };
  const MIXED: AlsoApplyTarget[] = [
    { state: "ks", current: "own" },
    { state: "NE", current: "shared" },
    { state: "NM", current: "empty" },
    { state: "MO", current: "own" },
  ];

  function keysByState(plan: ReturnType<typeof planContractSaves>): Record<string, string> {
    return Object.fromEntries(plan.alsoApply.map((input) => [input.state, input.specialtyKey]));
  }

  it("Also apply changes what each state's cell shows when Covers is All specialties", () => {
    const plan = planContractSaves({
      groupId: "g1",
      payerId: "p1",
      state: "mo",
      specialtyKey: "all",
      tableSpecialty: "pt",
      draft: DRAFT,
      alsoApply: MIXED,
    });
    expect(plan.primary).toEqual({
      groupId: "g1",
      payerId: "p1",
      state: "MO",
      specialtyKey: "all",
      contractingStatusId: "st-signed",
      tentativeEffectiveDate: "2026-12-01",
      effectiveDate: null,
      expirationDate: null,
      notes: "One agreement covers KS and MO.",
    });
    // own → that own record; shared → the shared record; empty → Covers.
    expect(keysByState(plan)).toEqual({ KS: "pt", NE: "all", NM: "all" });
    expect(plan.alsoApply.every((input) => !("notes" in input))).toBe(true);
  });

  it("Also apply records the specialty separately in a shared state when Covers is Specialty only", () => {
    const plan = planContractSaves({
      groupId: "g1",
      payerId: "p1",
      state: "MO",
      specialtyKey: "pt",
      tableSpecialty: "pt",
      draft: DRAFT,
      alsoApply: MIXED,
    });
    expect(plan.primary.specialtyKey).toBe("pt");
    expect(keysByState(plan)).toEqual({ KS: "pt", NE: "pt", NM: "pt" });
    expect(alsoApplySplitsShared({ state: "NE", current: "shared" }, "pt", "pt")).toBe(true);
    expect(alsoApplySplitsShared({ state: "NE", current: "shared" }, "all", "pt")).toBe(false);
    expect(alsoApplySplitsShared({ state: "KS", current: "own" }, "pt", "pt")).toBe(false);
    expect(alsoApplySplitsShared({ state: "NM", current: "empty" }, "pt", "pt")).toBe(false);
  });

  it("Also apply with no specialty table takes the Covers key everywhere", () => {
    const plan = planContractSaves({
      groupId: "g1",
      payerId: "p1",
      state: "MO",
      specialtyKey: "all",
      draft: DRAFT,
      alsoApply: MIXED,
    });
    expect(keysByState(plan)).toEqual({ KS: "all", NE: "all", NM: "all" });
  });
});
