import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Contract } from "@/types";

const state = vi.hoisted(() => ({
  assignment: null as unknown,
  sops: [] as unknown[],
}));

vi.mock("@/hooks/useAdmin", () => ({
  useSops: () => ({ data: state.sops, isLoading: false }),
}));
vi.mock("@/hooks/useLookups", () => ({
  useFacilities: () => ({ data: [] }),
}));
vi.mock("@/hooks/useProviders", () => ({
  useProviders: () => ({ data: [] }),
}));
vi.mock("@/hooks/useContractSopAssignments", () => ({
  useContractSopAssignment: () => ({ data: state.assignment, isLoading: false }),
  useAssignContractSop: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useContractProviderIds: () => ({ data: [] }),
}));

import { ContractSopAssignmentPanel } from "./ContractSopAssignmentPanel";

const contract = {
  id: "contract-1",
  groupId: "group-1",
  payerId: "payer-1",
  state: "NY",
} as Contract;

const baseSop = {
  id: "contract-sop",
  name: "Aetna Contract Application",
  caseType: "contract",
  payerId: "payer-1",
  groupId: null,
  states: ["NY"],
  archived: false,
  currentVersion: 4,
};

function renderPanel() {
  return renderToStaticMarkup(
    <ContractSopAssignmentPanel
      contract={contract}
      groupId="group-1"
      payerId="payer-1"
      state="NY"
    />,
  );
}

describe("Contract SOP assignment panel", () => {
  beforeEach(() => {
    state.assignment = null;
    state.sops = [
      baseSop,
      { ...baseSop, id: "enrollment-sop", name: "Aetna Enrollment", caseType: "enrollment" },
      { ...baseSop, id: "other-payer-sop", name: "BCBS Contract", payerId: "payer-2" },
    ];
  });

  it("requires an explicit compatible Contract SOP choice and does not require a provider to save", () => {
    const html = renderPanel();

    expect(html).toContain("Choose a published Contract SOP");
    expect(html).toContain(
      "Provider and location choices are launch inputs and are not required to save the assignment.",
    );
    expect(html).not.toContain("Aetna Enrollment");
    expect(html).not.toContain("BCBS Contract");
  });

  it("renders the pinned instructions and keeps exact-key portal work gated", () => {
    state.assignment = {
      assignment: {
        id: "assignment-1",
        contractId: contract.id,
        sopTemplateId: "contract-sop",
        sopVersion: 3,
        contextVersion: 2,
      },
      version: {
        name: "Aetna Contract Application",
        taskDefinitions: [
          {
            title: "Complete payer application",
            description: "Use the group contracting contact.",
            steps: [
              {
                label: "Enter group and facility details",
                detail: "Review all values before human submission.",
                stepType: "online_form",
                portalKey: "aetna_contract_form",
              },
            ],
          },
          {
            title: "Review second application section",
            steps: [
              {
                label: "Review the same configuration",
                stepType: "online_form",
                portalKey: "aetna_contract_form",
              },
            ],
          },
        ],
      },
      hasRecordedActivity: true,
    };

    const html = renderPanel();

    expect(html).toContain("Aetna Contract Application · v3");
    expect(html).toContain("Filling has started; replacement is locked.");
    expect(html).toContain("Use the group contracting contact.");
    expect(html).toContain("aetna_contract_form");
    expect(html).toContain("Work in portal");
    expect(html).toContain('disabled=""');
    expect(html).toContain("Launch readiness: resolver_unavailable");
    expect(html).toContain("Provider: not selected · Location: none");
    const stepIdentities = [...html.matchAll(/data-step-identity="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(stepIdentities).toHaveLength(2);
    expect(stepIdentities[0]).not.toBe(stepIdentities[1]);
  });
});
