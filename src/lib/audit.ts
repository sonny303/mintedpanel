// Internal helper that every mutating service uses to append a row to
// audit_log. Pulls active org and user identity from the auth store.

import { supabase } from "@/integrations/supabase/externalClient";
import { useAuthStore } from "@/lib/auth-store";
import type { AuditActionType } from "@/types";

export interface AuditInput {
  actionType: AuditActionType;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  description?: string;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  const state = useAuthStore.getState();
  const orgId = state.activeOrgId;
  if (!orgId) throw new Error("writeAudit: no active org");
  const userId = state.user?.id ?? null;
  const userName = state.fullName ?? state.user?.email ?? null;
  const { error } = await supabase.from("audit_log").insert({
    org_id: orgId,
    user_id: userId,
    user_name: userName,
    action_type: input.actionType,
    entity_type: input.entityType,
    entity_id: input.entityId,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
    description: input.description ?? null,
  });
  if (error) throw error;
}

export function requireActiveOrg(): string {
  const orgId = useAuthStore.getState().activeOrgId;
  if (!orgId) throw new Error("No active organization");
  return orgId;
}

export function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}
