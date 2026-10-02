import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  assignContractSop,
  eligibleContractProviderOptions,
  getContractSopAssignment,
  listContractProviderIds,
  type ContractSopAssignmentServiceCtx,
} from "./contractSopAssignments";

const CONTRACT_ID = "41414141-4242-4535-8686-797979797979";
const TEMPLATE_ID = "61616161-4242-4535-8686-797979797979";
const ASSIGNMENT_ID = "51515151-4242-4535-8686-797979797979";

function ctxFor(db: unknown): ContractSopAssignmentServiceCtx {
  return { db: db as SupabaseClient<Database>, orgId: "org-1" };
}

describe("contract SOP assignment service", () => {
  it("keeps terminal providers out of the Contract picker", () => {
    expect(
      eligibleContractProviderOptions(
        [
          { id: "active", status: "active" },
          { id: "onboarding", status: "onboarding" },
          { id: "terminated", status: "terminated" },
        ],
        new Set(["active", "onboarding", "terminated"]),
      ).map((provider) => provider.id),
    ).toEqual(["active", "onboarding"]);
  });

  it("passes an explicit template version and expected context version to the atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: ASSIGNMENT_ID,
        org_id: "org-1",
        contract_id: CONTRACT_ID,
        sop_template_id: TEMPLATE_ID,
        sop_version: 4,
        context_version: 7,
        created_by: "user-1",
        updated_by: "user-1",
        created_at: "2026-10-01T12:00:00.000Z",
        updated_at: "2026-10-01T12:00:00.000Z",
      },
      error: null,
    });

    const result = await assignContractSop(ctxFor({ rpc }), {
      contractId: CONTRACT_ID,
      sopTemplateId: TEMPLATE_ID,
      sopVersion: 4,
      expectedContextVersion: 6,
    });

    expect(rpc).toHaveBeenCalledWith("assign_contract_sop", {
      p_contract_id: CONTRACT_ID,
      p_sop_template_id: TEMPLATE_ID,
      p_sop_version: 4,
      p_expected_context_version: 6,
    });
    expect(result).toMatchObject({
      id: ASSIGNMENT_ID,
      contractId: CONTRACT_ID,
      sopTemplateId: TEMPLATE_ID,
      sopVersion: 4,
      contextVersion: 7,
    });
  });

  it("loads the pinned immutable version and locks replacement after real activity", async () => {
    const captures: Array<{ table: string; filters: Array<[string, unknown]>; columns?: string }> =
      [];
    const tableResults: Record<string, unknown> = {
      contract_sop_assignments: {
        data: {
          id: ASSIGNMENT_ID,
          org_id: "org-1",
          contract_id: CONTRACT_ID,
          sop_template_id: TEMPLATE_ID,
          sop_version: 4,
          context_version: 7,
          created_by: "user-1",
          updated_by: "user-1",
          created_at: "2026-10-01T12:00:00.000Z",
          updated_at: "2026-10-01T12:00:00.000Z",
        },
        error: null,
      },
      sop_template_versions: {
        data: {
          template_id: TEMPLATE_ID,
          version: 4,
          name: "Aetna contract packet",
          case_type: "contract",
          task_definitions: [
            { title: "Complete form", steps: [{ label: "Form", portalKey: "aetna_contract" }] },
          ],
          required_profile_attributes: [],
        },
        error: null,
      },
      fill_sessions: { data: null, count: 1, error: null },
    };

    const db = {
      from(table: string) {
        const capture = {
          table,
          filters: [] as Array<[string, unknown]>,
          columns: undefined as string | undefined,
        };
        captures.push(capture);
        const builder: Record<string, unknown> = {
          select(columns: string) {
            capture.columns = columns;
            return builder;
          },
          eq(column: string, value: unknown) {
            capture.filters.push([column, value]);
            return builder;
          },
          maybeSingle: () => Promise.resolve(tableResults[table]),
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(tableResults[table]).then(resolve, reject),
        };
        return builder;
      },
    };

    const details = await getContractSopAssignment(ctxFor(db), CONTRACT_ID);

    expect(details).toMatchObject({
      assignment: {
        contractId: CONTRACT_ID,
        sopTemplateId: TEMPLATE_ID,
        sopVersion: 4,
        contextVersion: 7,
      },
      version: {
        templateId: TEMPLATE_ID,
        version: 4,
        caseType: "contract",
        taskDefinitions: [{ title: "Complete form" }],
      },
      hasRecordedActivity: true,
    });
    expect(
      captures.find((capture) => capture.table === "contract_sop_assignments")?.filters,
    ).toEqual([
      ["org_id", "org-1"],
      ["contract_id", CONTRACT_ID],
    ]);
    expect(captures.find((capture) => capture.table === "sop_template_versions")?.filters).toEqual([
      ["template_id", TEMPLATE_ID],
      ["version", 4],
    ]);
    expect(captures.find((capture) => capture.table === "fill_sessions")?.filters).toEqual([
      ["org_id", "org-1"],
      ["contract_sop_assignment_id", ASSIGNMENT_ID],
      ["is_test", false],
    ]);
  });

  it("offers only providers with a current group membership and nonterminal status", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const captures: Array<{
      table: string;
      columns?: string;
      filters: Array<[string, unknown]>;
    }> = [];
    const tableData: Record<string, unknown> = {
      provider_group_assignments: {
        data: [
          { provider_id: "provider-active", start_date: today, end_date: null },
          {
            provider_id: "provider-future",
            start_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
            end_date: null,
          },
          { provider_id: "provider-ended", start_date: null, end_date: "2020-01-01" },
          { provider_id: "provider-terminated", start_date: null, end_date: null },
        ],
        error: null,
      },
      providers: {
        data: [
          { id: "provider-active", status: "active" },
          { id: "provider-terminated", status: "terminated" },
        ],
        error: null,
      },
    };
    const db = {
      from(table: string) {
        const capture = {
          table,
          filters: [] as Array<[string, unknown]>,
          columns: undefined as string | undefined,
        };
        captures.push(capture);
        const builder: Record<string, unknown> = {
          select(columns: string) {
            capture.columns = columns;
            return builder;
          },
          eq(column: string, value: unknown) {
            capture.filters.push([column, value]);
            return builder;
          },
          in(column: string, values: unknown[]) {
            capture.filters.push([column, values]);
            return builder;
          },
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(tableData[table]).then(resolve, reject),
        };
        return builder;
      },
    };

    await expect(listContractProviderIds(ctxFor(db), "group-1")).resolves.toEqual([
      "provider-active",
    ]);
    expect(captures[0].columns).toBe("provider_id, start_date, end_date");
    expect(captures[1].filters).toContainEqual(["id", ["provider-active", "provider-terminated"]]);
  });
});
