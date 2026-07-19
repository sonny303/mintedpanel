// Measured hotfix (2026-07-17) — interaction-latency regression pin. The
// wizard re-renders on every keystroke; TemplateTaskRow must stay wrapped in
// React.memo so typing in one step's field re-renders one task card, not every
// card (unwrapped, a 10-task template measured 264–296ms p50 per keystroke on
// the prod build at 4x CPU throttle). The other half of the contract — the
// wizard passing referentially stable (useCallback) handlers — is exercised
// end-to-end by e2e/template-typing-latency.spec.ts.
import { describe, expect, it, vi } from "vitest";

// TemplateTaskRow's import graph reaches the Supabase client since E6.5 (the
// FormStepPanel mounts its own org-cached hooks). CI has no VITE_SUPABASE_URL,
// so stub the client module — this test only inspects the memo wrapper, it
// never renders or queries.
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import { TemplateTaskRow } from "./TemplateTaskRow";

describe("TemplateTaskRow render contract", () => {
  it("is memoized so untouched task cards bail out of keystroke re-renders", () => {
    expect((TemplateTaskRow as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });
});
