import { describe, expect, it, vi } from "vitest";
import { retryTouchOnly, runTransitionWithTouch } from "./actionBridge";

describe("runTransitionWithTouch (F4.1.8/TE-11 sequencing)", () => {
  it("writes a single touch on a successful transition", async () => {
    const advance = vi.fn().mockResolvedValue({});
    const logTouch = vi.fn().mockResolvedValue({});
    const result = await runTransitionWithTouch(
      { advance, logTouch },
      { advanceArgs: { toState: "action_required" }, touchArgs: { touchType: "portal" } },
    );
    expect(result).toEqual({ transition: "ok", touch: "logged" });
    expect(advance).toHaveBeenCalledTimes(1);
    expect(logTouch).toHaveBeenCalledTimes(1);
  });

  it("writes NO touch when the transition fails", async () => {
    const advance = vi.fn().mockRejectedValue(new Error("invalid edge"));
    const logTouch = vi.fn().mockResolvedValue({});
    const result = await runTransitionWithTouch(
      { advance, logTouch },
      { advanceArgs: { toState: "approved" }, touchArgs: { touchType: "call" } },
    );
    expect(result.transition).toBe("failed");
    expect(result.touch).toBe("skipped");
    expect(advance).toHaveBeenCalledTimes(1);
    expect(logTouch).not.toHaveBeenCalled();
  });

  it("skips the touch when none is requested (transition-only)", async () => {
    const advance = vi.fn().mockResolvedValue({});
    const logTouch = vi.fn().mockResolvedValue({});
    const result = await runTransitionWithTouch(
      { advance, logTouch },
      { advanceArgs: { toState: "submitted" }, touchArgs: null },
    );
    expect(result).toEqual({ transition: "ok", touch: "skipped" });
    expect(advance).toHaveBeenCalledTimes(1);
    expect(logTouch).not.toHaveBeenCalled();
  });

  it("surfaces a touch-only retry when the touch fails after a successful transition", async () => {
    const advance = vi.fn().mockResolvedValue({});
    const logTouch = vi.fn().mockRejectedValueOnce(new Error("touch insert failed"));
    const result = await runTransitionWithTouch(
      { advance, logTouch },
      { advanceArgs: { toState: "action_required" }, touchArgs: { touchType: "portal" } },
    );
    expect(result.transition).toBe("ok");
    expect(result.touch).toBe("failed");
    expect(advance).toHaveBeenCalledTimes(1);

    // Retry re-attempts ONLY the touch — the transition is never re-run.
    logTouch.mockResolvedValueOnce({});
    const retry = await retryTouchOnly({ logTouch }, { touchType: "portal" });
    expect(retry).toEqual({ transition: "ok", touch: "logged" });
    expect(advance).toHaveBeenCalledTimes(1);
    expect(logTouch).toHaveBeenCalledTimes(2);
  });
});
