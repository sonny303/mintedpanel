// E4.1 F4.1.8 / TE-11 — the Action Bridge sequencing. A pipeline transition
// (E4.0) and a touch (E4.1) are decoupled events; the bridge lets one confirm
// write both. This is client-side composition only — no new RPC, no schema
// change, no transactional coupling:
//
//   - The transition runs FIRST (the existing advancePayerPipeline).
//   - A failed transition short-circuits: NO touch is written.
//   - Only on a successful transition does the (optional) touch run (logTouch,
//     source 'manual').
//   - A touch that fails AFTER a successful transition is a retry-touch-ONLY
//     path — the transition is never rolled back or duplicated; the caller
//     re-attempts only the touch.
//
// Pure and dependency-injected so the sequencing is unit-testable without React
// or Supabase (TE-11).

export type TransitionOutcome = "ok" | "failed";
export type TouchOutcomeStatus = "logged" | "failed" | "skipped";

export interface TransitionWithTouchResult {
  transition: TransitionOutcome;
  touch: TouchOutcomeStatus;
  transitionError?: unknown;
  touchError?: unknown;
}

export interface ActionBridgeDeps<AdvanceArgs, TouchArgs> {
  advance: (args: AdvanceArgs) => Promise<unknown>;
  logTouch: (args: TouchArgs) => Promise<unknown>;
}

export async function runTransitionWithTouch<A, T>(
  deps: ActionBridgeDeps<A, T>,
  args: { advanceArgs: A; touchArgs: T | null },
): Promise<TransitionWithTouchResult> {
  try {
    await deps.advance(args.advanceArgs);
  } catch (transitionError) {
    // Failed transition → no touch, ever.
    return { transition: "failed", touch: "skipped", transitionError };
  }
  if (!args.touchArgs) {
    return { transition: "ok", touch: "skipped" };
  }
  try {
    await deps.logTouch(args.touchArgs);
    return { transition: "ok", touch: "logged" };
  } catch (touchError) {
    // Transition already succeeded — surface a touch-only retry, never re-run
    // the transition.
    return { transition: "ok", touch: "failed", touchError };
  }
}

// Retry ONLY the touch after a successful transition whose touch failed (the
// transition is not re-attempted).
export async function retryTouchOnly<T>(
  deps: Pick<ActionBridgeDeps<unknown, T>, "logTouch">,
  touchArgs: T,
): Promise<TransitionWithTouchResult> {
  try {
    await deps.logTouch(touchArgs);
    return { transition: "ok", touch: "logged" };
  } catch (touchError) {
    return { transition: "ok", touch: "failed", touchError };
  }
}
