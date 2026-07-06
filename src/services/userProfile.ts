// User-level profile settings. The display name lives in the auth user's
// metadata (user_metadata.full_name) — the source the server resolves for the
// {{user.name}} preparer token on payer forms (src/server/userTokens.ts).
// Auth metadata, not tenant data: no org scoping, no audit_log row.
import { supabase } from "@/integrations/supabase/externalClient";

export async function updateDisplayName(fullName: string): Promise<string> {
  const trimmed = fullName.trim();
  if (!trimmed) throw new Error("Name is required");
  const { error } = await supabase.auth.updateUser({ data: { full_name: trimmed } });
  if (error) throw new Error(error.message);
  return trimmed;
}
