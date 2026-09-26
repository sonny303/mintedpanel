import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => {
  let state = { activeOrgId: "org-a", user: { id: "actor-a" } };
  const listeners: Array<(next: typeof state, previous: typeof state) => void> = [];
  const queryClient = { invalidateQueries: vi.fn() };
  const authStore = Object.assign(
    vi.fn((selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state)),
    {
      subscribe: vi.fn((listener: (next: typeof state, previous: typeof state) => void) => {
        listeners.push(listener);
        return () => undefined;
      }),
    },
  );
  return {
    authStore,
    context: () => state,
    listeners,
    queryClient,
    setContext(next: typeof state) {
      const previous = state;
      state = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
});

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  fetch: vi.fn(),
  plan: vi.fn(),
  prepare: vi.fn(),
  recordPayer: vi.fn(),
  recordTest: vi.fn(),
  removePayerForm: vi.fn(),
  retirePayerForm: vi.fn(),
  uploadPayerForm: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useCallback: (callback: unknown) => callback };
});
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
  useQuery: vi.fn(),
  useQueryClient: () => holder.queryClient,
}));
vi.mock("@/lib/auth-store", () => ({
  useActiveOrgId: () => holder.context().activeOrgId,
  useAuthStore: holder.authStore,
}));
vi.mock("@/lib/audit", () => ({
  currentUserId: () => holder.context().user?.id ?? null,
  requireActiveOrg: () => {
    const orgId = holder.context().activeOrgId;
    if (!orgId) throw new Error("No active organization");
    return orgId;
  },
}));
vi.mock("@/lib/payerFormFill", () => ({ planPayerFormFill: mocks.plan }));
vi.mock("@/lib/payerFormFillClient", () => ({
  downloadPayerFormOutput: vi.fn(),
  preparePayerFormFill: mocks.prepare,
}));
vi.mock("@/lib/pdfFieldImportClient", () => ({ fetchPdfBytes: mocks.fetch }));
vi.mock("@/lib/pdfFieldImport", () => ({
  pdfFormPortalKey: (familyId: string) => `payer-form:${familyId}`,
}));
vi.mock("@/services/fillSessions", () => ({
  recordPayerFormFill: mocks.recordPayer,
  recordTestFillFromApp: mocks.recordTest,
}));
vi.mock("@/services/payerForms", () => ({
  getPayerFormDownload: mocks.download,
  listCurrentTemplatePayerForms: vi.fn(),
  retirePayerForm: mocks.retirePayerForm,
  uploadPayerForm: mocks.uploadPayerForm,
}));

import { downloadPayerFormOutput } from "@/lib/payerFormFillClient";
import { createFillRunGuard } from "@/lib/fillRunGuard";
import { useFillPayerForm, type FillPayerFormVars } from "./usePayerForms";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function vars(formId: string, overrides: Partial<FillPayerFormVars> = {}): FillPayerFormVars {
  return {
    formId,
    familyId: "family-a",
    caseId: "case-a",
    providerId: "provider-a",
    rows: [{ id: "map-a" }] as never,
    tokenValues: { "provider.npi": "1111111111" },
    fileStem: "filled",
    ...overrides,
  };
}

function useFillMutation() {
  return useFillPayerForm() as unknown as {
    mutationFn(input: FillPayerFormVars): Promise<Record<string, unknown>>;
    hasPendingRecording(caseId: string, formId: string, isTest?: boolean): boolean;
    getPendingRecordingSummary(
      caseId: string,
      formId: string,
      isTest?: boolean,
    ): { written: number; rejectedCount: number; needsReviewCount: number } | null;
    clearPendingRecording(caseId: string, formId: string, isTest?: boolean): boolean;
  };
}

beforeEach(() => {
  holder.setContext({ activeOrgId: "org-a", user: { id: "actor-a" } });
  vi.clearAllMocks();
  mocks.plan.mockImplementation((rows: readonly unknown[]) => ({
    entries: rows,
    fill: rows,
    fieldsSkipped: [],
    manualLabels: [],
  }));
  mocks.download.mockResolvedValue({ url: "https://storage.example.test/signed" });
  mocks.fetch.mockResolvedValue(new ArrayBuffer(8));
  mocks.prepare.mockResolvedValue({
    output: new Uint8Array([1, 2, 3]),
    written: 1,
    rejected: [],
    event: {
      schemaVersion: 2,
      fieldsAttempted: 1,
      fieldsVerified: 0,
      fieldsRejected: 0,
      fieldOutcomes: [],
    },
  });
  mocks.recordPayer.mockResolvedValue({});
  mocks.recordTest.mockResolvedValue({});
});

describe("useFillPayerForm recording retry and context guards", () => {
  it("retries a lost recording response with the same event and without a second PDF generation", async () => {
    mocks.recordPayer.mockRejectedValueOnce(new Error("lost response"));
    mocks.prepare.mockResolvedValueOnce({
      output: new Uint8Array([1, 2, 3]),
      written: 1,
      rejected: ["local-only field label"],
      event: {
        schemaVersion: 2,
        fieldsAttempted: 1,
        fieldsVerified: 0,
        fieldsRejected: 1,
        fieldOutcomes: [],
      },
    });
    const fill = useFillMutation();
    const original = vars("form-retry");

    await expect(fill.mutationFn(original)).rejects.toThrow("lost response");
    expect(fill.hasPendingRecording("case-a", "form-retry")).toBe(true);
    expect(fill.getPendingRecordingSummary("case-a", "form-retry")).toEqual({
      written: 1,
      rejectedCount: 1,
      needsReviewCount: 1,
    });
    expect(downloadPayerFormOutput).toHaveBeenCalledTimes(1);
    expect(mocks.plan).toHaveBeenCalledTimes(1);

    const retried = await fill.mutationFn(vars("form-retry", { rows: [], tokenValues: {} }));

    expect(retried.recordingRetried).toBe(true);
    expect(retried).toMatchObject({ rejectedCount: 1, needsReviewCount: 1 });
    expect(retried).not.toHaveProperty("rejected");
    expect(mocks.plan).toHaveBeenCalledTimes(1);
    expect(downloadPayerFormOutput).toHaveBeenCalledTimes(1);
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.recordPayer).toHaveBeenCalledTimes(2);
    expect(mocks.recordPayer.mock.calls[1]?.[0]).toMatchObject({
      id: mocks.recordPayer.mock.calls[0]?.[0].id,
      startedAt: mocks.recordPayer.mock.calls[0]?.[0].startedAt,
      completedAt: mocks.recordPayer.mock.calls[0]?.[0].completedAt,
      event: mocks.recordPayer.mock.calls[0]?.[0].event,
    });
    expect(fill.hasPendingRecording("case-a", "form-retry")).toBe(false);
  });

  it("aborts before PDF generation or download when the actor changes during byte fetch", async () => {
    const bytes = deferred<ArrayBuffer>();
    mocks.fetch.mockReturnValueOnce(bytes.promise);
    const fill = useFillMutation();
    const operation = fill.mutationFn(vars("form-context"));
    await Promise.resolve();
    await Promise.resolve();

    holder.setContext({ activeOrgId: "org-b", user: { id: "actor-b" } });
    bytes.resolve(new ArrayBuffer(8));

    await expect(operation).rejects.toThrow("active fill context changed");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(downloadPayerFormOutput).not.toHaveBeenCalled();
    expect(mocks.recordPayer).not.toHaveBeenCalled();
    expect(fill.hasPendingRecording("case-a", "form-context")).toBe(false);
  });

  it("invalidates an in-flight run when its owner leaves and returns to the same form", async () => {
    const bytes = deferred<ArrayBuffer>();
    mocks.fetch.mockReturnValueOnce(bytes.promise);
    const guard = createFillRunGuard("case-a:form-a");
    const runToken = guard.capture();
    const fill = useFillMutation();
    const operation = fill.mutationFn(
      vars("form-a", { isCurrent: () => guard.isCurrent(runToken) }),
    );
    await Promise.resolve();
    await Promise.resolve();

    guard.setContext("case-b:form-b");
    guard.setContext("case-a:form-a");
    bytes.resolve(new ArrayBuffer(8));

    await expect(operation).rejects.toThrow("active fill context changed");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(downloadPayerFormOutput).not.toHaveBeenCalled();
    expect(mocks.recordPayer).not.toHaveBeenCalled();
  });

  it("does not report success when the owner invalidates during outcome recording", async () => {
    const recording = deferred<void>();
    mocks.recordPayer.mockReturnValueOnce(recording.promise);
    const guard = createFillRunGuard("case-a:form-a");
    const runToken = guard.capture();
    const fill = useFillMutation();
    const operation = fill.mutationFn(
      vars("form-a", { isCurrent: () => guard.isCurrent(runToken) }),
    );
    for (let index = 0; index < 8 && mocks.recordPayer.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(mocks.recordPayer).toHaveBeenCalledTimes(1);

    guard.invalidate();
    recording.resolve();
    await expect(operation).rejects.toThrow("active fill context changed");
    expect(downloadPayerFormOutput).toHaveBeenCalledTimes(1);
    expect(fill.getPendingRecordingSummary("case-a", "form-a")).toMatchObject({
      needsReviewCount: 0,
    });
    fill.clearPendingRecording("case-a", "form-a");
  });
});
