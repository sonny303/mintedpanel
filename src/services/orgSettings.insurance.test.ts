import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ from: vi.fn(), audit: vi.fn() }));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: state.from },
}));
vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-1",
  writeAudit: state.audit,
}));

import { createGroupInsurancePolicy, updateGroupInsurancePolicy } from "./orgSettings";
import type { InsurancePolicyInput } from "./orgSettings";

const input: InsurancePolicyInput = {
  groupId: "group-1",
  insuranceType: "professional_liability",
  coverageLevel: "primary",
  insurerName: "Example Insurer",
  policyNumber: "POL-1",
  policyStartDate: "2026-01-01",
  policyEndDate: "2027-01-01",
};

const row = {
  id: "policy-1",
  org_id: "org-1",
  group_id: input.groupId,
  insurance_type: input.insuranceType,
  coverage_level: input.coverageLevel,
  insurer_name: input.insurerName,
  policy_number: input.policyNumber,
  policy_start_date: input.policyStartDate,
  policy_end_date: input.policyEndDate,
  notes: null,
};

const query = {
  select: vi.fn(),
  eq: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.insert.mockReturnValue(query);
  query.update.mockReturnValue(query);
  query.single.mockResolvedValue({ data: row, error: null });
  query.maybeSingle.mockResolvedValue({ data: row, error: null });
  state.from.mockReturnValue(query);
  state.audit.mockResolvedValue(undefined);
});

describe("group insurance policy date order", () => {
  it("rejects an end date before the start date without writing", async () => {
    await expect(
      createGroupInsurancePolicy({ ...input, policyEndDate: "2025-01-01" }),
    ).rejects.toThrow("End date must be on or after start date");
    expect(state.from).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it.each(["2026-01-01", "2027-01-01"])(
    "saves a policy when the end date is %s",
    async (policyEndDate) => {
      await createGroupInsurancePolicy({ ...input, policyEndDate });
      expect(query.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          policy_start_date: "2026-01-01",
          policy_end_date: policyEndDate,
        }),
      );
      expect(state.audit).toHaveBeenCalledOnce();
    },
  );

  it.each([{ policyEndDate: "2025-01-01" }, { policyStartDate: "2028-01-01" }])(
    "rejects an invalid partial update against the stored dates: %o",
    async (patch) => {
      await expect(updateGroupInsurancePolicy("policy-1", patch)).rejects.toThrow(
        "End date must be on or after start date",
      );
      expect(query.update).not.toHaveBeenCalled();
      expect(state.audit).not.toHaveBeenCalled();
    },
  );

  it("saves a valid partial update", async () => {
    await updateGroupInsurancePolicy("policy-1", { policyEndDate: "2026-01-01" });
    expect(query.update).toHaveBeenCalledWith({ policy_end_date: "2026-01-01" });
    expect(state.audit).toHaveBeenCalledOnce();
  });

  it("allows correction of an already saved invalid interval", async () => {
    query.maybeSingle.mockResolvedValue({
      data: { ...row, policy_end_date: "2025-01-01" },
      error: null,
    });
    await updateGroupInsurancePolicy("policy-1", { policyEndDate: "2027-01-01" });
    expect(query.update).toHaveBeenCalledWith({ policy_end_date: "2027-01-01" });
    expect(state.audit).toHaveBeenCalledOnce();
  });
});
