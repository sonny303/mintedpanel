import { describe, expect, it, vi } from "vitest";
import { createFillRunGuard, createFillRunLatch, isPdfFillContextCurrent } from "./fillRunGuard";

describe("PDF fill run context", () => {
  it("does not download a prepared PDF after the actor changes during save", async () => {
    const guard = createFillRunGuard("case-a:facility-a");
    const runToken = guard.capture();
    const expectedActor = {
      orgId: "org-a",
      userId: "actor-a",
      authGeneration: 2,
      contextEpoch: 7,
    };
    let currentActor = { ...expectedActor };
    let finishSave: (() => void) | undefined;
    const save = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const download = vi.fn();
    const run = save.then(() => {
      const actor = currentActor;
      if (
        isPdfFillContextCurrent({
          runIsCurrent: guard.isCurrent(runToken),
          expectedSourceGeneration: 1,
          currentSourceGeneration: 1,
          expectedActor,
          currentActor: actor,
        })
      ) {
        download();
      }
    });

    currentActor = { ...currentActor, authGeneration: 3 };
    finishSave?.();
    await run;

    expect(download).not.toHaveBeenCalled();
  });

  it("rejects a file or dictionary change during PDF preparation", () => {
    const actor = {
      orgId: "org-a",
      userId: "actor-a",
      authGeneration: 2,
      contextEpoch: 7,
    };

    expect(
      isPdfFillContextCurrent({
        runIsCurrent: true,
        expectedSourceGeneration: 1,
        currentSourceGeneration: 2,
        expectedActor: actor,
        currentActor: actor,
      }),
    ).toBe(false);
  });

  it("admits only one run while fill-time reads are deferred", async () => {
    const latch = createFillRunLatch();
    let finishRefresh: (() => void) | undefined;
    const refresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const fill = vi.fn();
    const run = async () => {
      if (!latch.tryStart()) return;
      try {
        await refresh;
        fill();
      } finally {
        latch.finish();
      }
    };

    const first = run();
    const second = run();
    expect(fill).not.toHaveBeenCalled();
    finishRefresh?.();
    await Promise.all([first, second]);

    expect(fill).toHaveBeenCalledTimes(1);
  });
});
