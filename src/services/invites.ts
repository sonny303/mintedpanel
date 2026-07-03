// pending_invites CRUD + membership removal + claim_invites RPC.
// pending_invites and claim_invites aren't yet in the generated Database
// types, so table access goes through narrow, locally-typed shims.
import { supabase } from '@/integrations/supabase/externalClient';
import { currentUserId, requireActiveOrg, writeAudit } from '@/lib/audit';
import type { AppRole } from '@/types';

export interface PendingInvite {
  id: string;
  orgId: string;
  email: string;
  role: AppRole;
  fullName: string | null;
  invitedBy: string | null;
  createdAt: string;
}

interface PendingInviteRow {
  id: string;
  org_id: string;
  email: string;
  role: AppRole;
  full_name: string | null;
  invited_by: string | null;
  created_at: string;
}

function toInvite(row: PendingInviteRow): PendingInvite {
  return {
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
  };
}

// Narrow escape hatch: pending_invites is not in generated Database types.
const invitesTable = () =>
  (supabase.from as unknown as (name: string) => {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, opts?: { ascending: boolean }) => Promise<{
          data: PendingInviteRow[] | null;
          error: { message: string } | null;
        }>;
      };
    };
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{
          data: PendingInviteRow | null;
          error: { code?: string; message: string } | null;
        }>;
      };
    };
    delete: () => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => Promise<{
          data: PendingInviteRow[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  })('pending_invites');

export async function listPendingInvites(): Promise<PendingInvite[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await invitesTable()
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toInvite);
}

export interface CreatePendingInviteInput {
  email: string;
  role: AppRole;
  fullName: string | null;
}

export class DuplicateInviteError extends Error {
  constructor() {
    super('An invite for that email is already pending.');
    this.name = 'DuplicateInviteError';
  }
}

export async function createPendingInvite(
  input: CreatePendingInviteInput,
): Promise<PendingInvite> {
  const orgId = requireActiveOrg();
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error('Email is required');
  const payload = {
    org_id: orgId,
    email,
    role: input.role,
    full_name: input.fullName?.trim() ? input.fullName.trim() : null,
    invited_by: currentUserId(),
  };
  const { data, error } = await invitesTable()
    .insert(payload)
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new DuplicateInviteError();
    throw new Error(error.message);
  }
  if (!data) throw new Error('Failed to create invite');
  const invite = toInvite(data);
  await writeAudit({
    actionType: 'CREATE',
    entityType: 'pending_invite',
    entityId: invite.id,
    after: invite,
    description: `Invited ${invite.email} as ${invite.role}`,
  });
  return invite;
}

export async function revokePendingInvite(invite: PendingInvite): Promise<void> {
  const orgId = requireActiveOrg();
  const { error } = await invitesTable().delete().eq('id', invite.id).eq('org_id', orgId);
  if (error) throw new Error(error.message);
  await writeAudit({
    actionType: 'DELETE',
    entityType: 'pending_invite',
    entityId: invite.id,
    before: invite,
    description: `Revoked invite for ${invite.email}`,
  });
}

export interface RemoveMembershipInput {
  id: string;
  email: string | null;
  role: AppRole;
}

export async function removeMembership(input: RemoveMembershipInput): Promise<void> {
  const orgId = requireActiveOrg();
  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('id', input.id)
    .eq('org_id', orgId);
  if (error) throw error;
  await writeAudit({
    actionType: 'DELETE',
    entityType: 'membership',
    entityId: input.id,
    before: input,
    description: `Removed ${input.email ?? 'member'} (${input.role})`,
  });
}

export async function claimInvites(): Promise<number> {
  const rpc = supabase.rpc as unknown as (name: string) => Promise<{
    data: number | null;
    error: { message: string } | null;
  }>;
  const { data, error } = await rpc('claim_invites');
  if (error) throw new Error(error.message);
  return typeof data === 'number' ? data : 0;
}
