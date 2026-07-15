// E4.1 F4.1.3 / E4.2 F4.2.5 — the org-level next-best-action ranking config READ
// seam. The admin surface that PERSISTS this config is E4.2 F4.2.5 (out of scope
// for E4.1). Until it exists there is no stored row, so this returns null and
// the queue uses its shipped default (overdue follow-ups first). When E4.2
// lands, point this read at the org-settings store — the pure reducer already
// consumes the validated shape via resolveQueueRankingConfig, so no reducer
// change is needed then. Org-scoped by construction (requireActiveOrg) so the
// day it reads a stored row it is already tenant-bounded.
import { requireActiveOrg } from "@/lib/audit";

export async function getQueueRankingConfigRaw(): Promise<unknown> {
  requireActiveOrg();
  // No E4.2 store yet → no saved config → shipped default.
  return null;
}
