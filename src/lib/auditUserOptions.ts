import type { AuditLogEntry } from "@/types";

export function auditUserOptions(rows: Pick<AuditLogEntry, "userId" | "userName">[]) {
  const names = new Map<string, string | null>();
  for (const row of rows) {
    if (!row.userId) continue;
    if (!names.has(row.userId) || (!names.get(row.userId) && row.userName)) {
      names.set(row.userId, row.userName);
    }
  }
  return Array.from(names, ([id, name]) => ({ id, name: name || id.slice(0, 8) }));
}
