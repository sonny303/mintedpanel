// E2.3 TE-4 — the two narrow reads the queue adds on top of the org caches it
// already shares (cases, touches, facilities, lookups, readiness inputs).
// Batched style: one query per source table, joined in memory by the pure
// module — never per-case round-trips.
//
// PHI posture: PROVIDER_LIST_COLUMNS deliberately lacks start_date, so the
// queue selects its own explicit, PHI-safe provider projection (the
// narrow-projection idiom) — id, name, start_date; never select("*"), no
// DOB/SSN/home-address columns in any queue payload. The tasks read carries
// sop_content ONLY to reduce it to a cadence number at this boundary — the
// jsonb never enters the query cache.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";
import { normalizePortalKey } from "@/lib/tokenFormat";

export interface QueueProviderRow {
  id: string;
  name: string;
  startDate: string | null;
}

const QUEUE_PROVIDER_COLUMNS = "id, first_name, last_name, start_date";

export async function listQueueProviderRows(): Promise<QueueProviderRow[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("providers")
    .select(QUEUE_PROVIDER_COLUMNS)
    .eq("org_id", orgId)
    .neq("status", "terminated");
  if (error) throw error;
  const rows = camelizeRow<
    Array<{ id: string; firstName: string; lastName: string; startDate: string | null }>
  >(data ?? []);
  return rows.map((r) => ({
    id: r.id,
    name: `${r.firstName} ${r.lastName}`.trim(),
    startDate: r.startDate ?? null,
  }));
}

export interface QueueTaskRow {
  id: string;
  caseId: string | null;
  title: string;
  status: string;
  sortOrder: number;
  dueDate: string | null;
  /** The smallest positive followUpEveryDays among the task's stamped SOP
   * steps (E1.7b/E2.2), null when no step carries a cadence. */
  cadenceDays: number | null;
}

const QUEUE_TASK_COLUMNS = "id, case_id, title, status, sort_order, due_date, sop_content";

/** Reduce a task's sop_content jsonb to its smallest step cadence. Steps are
 * stored with the SOPStep camelCase keys; a malformed body reduces to null
 * rather than throwing (legacy seed rows carry older shapes). */
function minStepCadence(sopContent: unknown): number | null {
  if (!Array.isArray(sopContent)) return null;
  let min: number | null = null;
  for (const step of sopContent) {
    if (typeof step !== "object" || step === null) continue;
    const value = (step as { followUpEveryDays?: unknown }).followUpEveryDays;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      min = min === null ? value : Math.min(min, value);
    }
  }
  return min;
}

export async function listQueueTaskRows(): Promise<QueueTaskRow[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("tasks")
    .select(QUEUE_TASK_COLUMNS)
    .eq("org_id", orgId);
  if (error) throw error;
  const rows = camelizeRow<
    Array<{
      id: string;
      caseId: string | null;
      title: string;
      status: string;
      sortOrder: number;
      dueDate: string | null;
      sopContent: unknown;
    }>
  >(data ?? []);
  return rows.map((r) => ({
    id: r.id,
    caseId: r.caseId ?? null,
    title: r.title,
    status: r.status,
    sortOrder: r.sortOrder,
    dueDate: r.dueDate ?? null,
    cadenceDays: minStepCadence(r.sopContent),
  }));
}

/** E4.3 F4.3.1 — per-case distinct portal keys among the case's OPEN tasks'
 * online_form steps, so the My Cases queue can show a "Work in portal" launcher
 * without loading full task bodies into its cache. The sop_content jsonb is
 * reduced to portal keys at this boundary (never cached), mirroring the cadence
 * reduction above. Keys are normalized bare/lowercase for a literal registry
 * join. */
export interface CasePortalKeys {
  caseId: string;
  portalKeys: string[];
}

const CASE_PORTAL_TASK_COLUMNS = "case_id, status, sop_content";

export async function listCasePortalKeys(): Promise<CasePortalKeys[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("tasks")
    .select(CASE_PORTAL_TASK_COLUMNS)
    .eq("org_id", orgId);
  if (error) throw error;
  const byCase = new Map<string, Set<string>>();
  for (const row of (data ?? []) as Array<{
    case_id: string | null;
    status: string;
    sop_content: unknown;
  }>) {
    if (!row.case_id || row.status === "completed") continue;
    const steps = Array.isArray(row.sop_content) ? row.sop_content : [];
    for (const step of steps) {
      const key = normalizePortalKey((step as { portalKey?: string }).portalKey);
      if (!key) continue;
      if (!byCase.has(row.case_id)) byCase.set(row.case_id, new Set());
      byCase.get(row.case_id)?.add(key);
    }
  }
  return [...byCase.entries()].map(([caseId, keys]) => ({ caseId, portalKeys: [...keys] }));
}
