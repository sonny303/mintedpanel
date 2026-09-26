import { describe, expect, it, vi } from "vitest";
import { createFillRunLatch } from "@/lib/fillRunGuard";
import {
  commitAnalysisIfIdle,
  prepareAndDownloadPdfIfCurrent,
  runExclusivePdfFill,
} from "./pdfFillRun";

describe("PDF fill orchestration", () => {
  it("runs one mutation when two clicks arrive during deferred fresh reads", async () => {
    const latch = createFillRunLatch();
    let finishRefresh: (() => void) | undefined;
    const refresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const mutation = vi.fn();
    const run = () =>
      runExclusivePdfFill(latch, async () => {
        await refresh;
        mutation();
      });

    const first = run();
    const second = run();
    expect(mutation).not.toHaveBeenCalled();
    finishRefresh?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.started).toBe(true);
    expect(secondResult.started).toBe(false);
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it("does not let a finishing analysis overwrite active generation", () => {
    const setAnalysis = vi.fn();

    expect(commitAnalysisIfIdle(true, setAnalysis)).toBe(false);
    expect(commitAnalysisIfIdle(false, setAnalysis)).toBe(true);
    expect(setAnalysis).toHaveBeenCalledTimes(1);
  });

  it("cancels local download when the context changes during PDF preparation", async () => {
    let current = true;
    let finishPreparation: (() => void) | undefined;
    const prepare = new Promise<{ bytes: string }>((resolve) => {
      finishPreparation = () => resolve({ bytes: "prepared" });
    });
    const download = vi.fn();
    const result = prepareAndDownloadPdfIfCurrent({
      isCurrent: () => current,
      prepare: () => prepare,
      download,
    });

    current = false;
    finishPreparation?.();
    await expect(result).resolves.toEqual({ status: "stale" });
    expect(download).not.toHaveBeenCalled();
  });
});
