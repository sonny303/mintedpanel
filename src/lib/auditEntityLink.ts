// Where an Audit Log row's entity links. Most rows carry their own entity's
// id, but SOP task generation (createCaseTasks, appendCaseTasks, the
// create_case_with_tasks RPC) writes ONE `task` row per batch whose entity_id
// is the CASE id and whose `after` lists the new `taskIds`. That row opens the
// case; a single-task row still opens the task. Pure.
import type { AuditLogEntry } from "@/types";

export interface AuditEntityTarget {
  to: "/cases/$id" | "/providers/$id" | "/tasks/$id";
  id: string;
}

function isCaseTaskBatch(after: unknown): boolean {
  return (
    typeof after === "object" &&
    after !== null &&
    "taskIds" in after &&
    Array.isArray(after.taskIds)
  );
}

/** The page an audit row's entity opens, or null when it has none. */
export function auditEntityTarget(
  entry: Pick<AuditLogEntry, "entityType" | "entityId" | "after">,
): AuditEntityTarget | null {
  const { entityType, entityId, after } = entry;
  if (!entityId) return null;
  switch (entityType) {
    case "case":
    case "credential_case":
      return { to: "/cases/$id", id: entityId };
    case "provider":
      return { to: "/providers/$id", id: entityId };
    case "task":
      return { to: isCaseTaskBatch(after) ? "/cases/$id" : "/tasks/$id", id: entityId };
    default:
      return null;
  }
}
