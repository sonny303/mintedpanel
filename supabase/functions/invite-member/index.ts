// Sends the Supabase auth invite email for a pending_invites row.
// Guardrails: caller must be an admin of the target org AND a matching
// pending_invites row must exist. Verified with a service-role client.
// Never logs secrets.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Payload {
  email?: unknown;
  orgId?: unknown;
  fullName?: unknown;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { error: 'Server not configured' });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Missing auth token' });

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const orgId = typeof payload.orgId === 'string' ? payload.orgId : '';
  const fullName =
    typeof payload.fullName === 'string' && payload.fullName.trim().length > 0
      ? payload.fullName.trim()
      : null;
  if (!email || !orgId || !/.+@.+\..+/.test(email)) {
    return json(400, { error: 'email and orgId are required' });
  }

  // Resolve the caller with an anon client bound to their JWT.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return json(401, { error: 'Not authenticated' });
  }
  const caller = userData.user;

  // Service-role client for permission checks and admin operations.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: membership, error: membershipError }, { data: pending, error: pendingError }] =
    await Promise.all([
      admin
        .from('memberships')
        .select('id, role')
        .eq('user_id', caller.id)
        .eq('org_id', orgId)
        .maybeSingle(),
      admin
        .from('pending_invites')
        .select('id')
        .eq('org_id', orgId)
        .eq('email', email)
        .maybeSingle(),
    ]);

  if (membershipError || !membership || membership.role !== 'admin') {
    return json(403, { error: 'Not authorized' });
  }
  if (pendingError || !pending) {
    return json(403, { error: 'No matching pending invite' });
  }

  const origin =
    req.headers.get('origin') ?? req.headers.get('referer')?.replace(/\/$/, '') ?? '';
  const redirectTo = origin ? `${origin.replace(/\/$/, '')}/welcome` : undefined;

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: fullName ? { full_name: fullName } : undefined,
  });

  if (inviteError) {
    const message = inviteError.message ?? '';
    // Supabase returns a 422 / "already been registered" for existing users.
    if (/already/i.test(message) || (inviteError as { status?: number }).status === 422) {
      return json(200, {
        ok: true,
        alreadyExists: true,
        message: "User already has an account; they'll be added on next sign-in.",
      });
    }
    return json(500, { error: 'Failed to send invite email' });
  }

  return json(200, { ok: true });
});
