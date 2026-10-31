// MINT-108 — the reads behind the daily follow-up digest job
// (src/server/jobs/followupDigestRun.ts).
//
// Server-only surface, like ./orgMemberships.ts: there is no browser-default
// ctx, because the caller holds the service-role client, which bypasses RLS.
// Tenant isolation is this file's job. After the one cross-org discovery read
// (org ids, the on/off flag and the org's name), every query is filtered by
// the org it serves, and a case's embedded provider is used only when it
// belongs to that org. `profiles` and `payers` have no org column: profiles
// arrive embedded in the org's memberships, payers (a global catalog) embedded
// in the org's cases.
//
// PHI: narrowed column lists, mapped field by field, so a column the select
// did not name cannot ride along. The provider's first and last name are the
// only provider columns read; touches are read for their follow-up fields,
// never `notes`.
//
// Complete reads: hosted PostgREST caps a response at 1,000 rows and says
// nothing, so every list that can grow runs through readCompletePages with an
// exact count and a stable order. A sequence's steps are not paged: the
// database allows at most one digest step per org.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { OPEN_CASE_STATUSES } from "@/lib/caseStatus";
import { readCompletePages } from "@/lib/completePages";
import { isMissingNotificationSequenceTablesError } from "@/lib/dbErrors";
import type { DigestCase, DigestMember, DigestTouchpoint } from "@/lib/followUpDigest";

export interface FollowUpDigestReadCtx {
  db: SupabaseClient<Database>;
}

export interface FollowUpDigestOrg {
  orgId: string;
  enabled: boolean;
  practiceName: string;
}

export interface FollowUpDigestOrgData {
  members: DigestMember[];
  /** The org's open cases, with display-ready provider and payer names. */
  cases: DigestCase[];
  /** Every touchpoint of the org, follow-up fields only. */
  touchpoints: DigestTouchpoint[];
}

export const DIGEST_SEQUENCE_COLUMNS = "id, org_id, enabled, organizations(name)";
export const DIGEST_MEMBER_COLUMNS =
  "id, user_id, role, created_at, profiles(first_name, last_name, full_name, email)";
export const DIGEST_CASE_COLUMNS =
  "id, org_id, case_number, assigned_to, case_status, submitted_date, providers(org_id, first_name, last_name), payers(name, avg_decision_days)";
export const DIGEST_TOUCH_COLUMNS =
  "id, case_id, touch_date, created_at, next_follow_up_date, clears_follow_up";

const UNKNOWN_PROVIDER = "Unknown provider";
const UNKNOWN_PAYER = "Unknown payer";

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Every org with a follow-up digest sequence row, on or off. The only
 * cross-org read: org ids, the flag and the org's name. Before the MINT-107
 * migration is applied the table is missing, which means no org has the
 * digest, so the answer is empty.
 */
export async function listFollowUpDigestOrgs(
  ctx: FollowUpDigestReadCtx,
): Promise<FollowUpDigestOrg[]> {
  const query = ctx.db
    .from("notification_sequences")
    .select(DIGEST_SEQUENCE_COLUMNS, { count: "exact" })
    .eq("purpose", "followup_digest")
    .order("org_id", { ascending: true })
    .order("id", { ascending: true });
  let rows: unknown[];
  try {
    rows = await readCompletePages(async (from, to) => await query.range(from, to), {
      label: "Follow-up digest sequences",
    });
  } catch (error) {
    if (isMissingNotificationSequenceTablesError(error)) return [];
    throw error;
  }
  return rows.flatMap((raw) => {
    const row = record(raw);
    const orgId = text(row?.org_id);
    if (!row || !orgId) return [];
    return [
      {
        orgId,
        enabled: row.enabled === true,
        practiceName: text(record(row.organizations)?.name)?.trim() ?? "",
      },
    ];
  });
}

async function listMembers(ctx: FollowUpDigestReadCtx, orgId: string): Promise<DigestMember[]> {
  const query = ctx.db
    .from("memberships")
    .select(DIGEST_MEMBER_COLUMNS, { count: "exact" })
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  const rows = await readCompletePages(async (from, to) => await query.range(from, to), {
    label: "Digest members",
  });
  const seen = new Set<string>();
  return rows.flatMap((raw) => {
    const row = record(raw);
    const userId = text(row?.user_id);
    if (!row || !userId || seen.has(userId)) return [];
    seen.add(userId);
    const profile = record(row.profiles);
    return [
      {
        userId,
        role: text(row.role) ?? "",
        firstName: text(profile?.first_name),
        lastName: text(profile?.last_name),
        fullName: text(profile?.full_name),
        email: text(profile?.email),
      },
    ];
  });
}

async function listOpenCases(ctx: FollowUpDigestReadCtx, orgId: string): Promise<DigestCase[]> {
  const query = ctx.db
    .from("credential_cases")
    .select(DIGEST_CASE_COLUMNS, { count: "exact" })
    .eq("org_id", orgId)
    .in("case_status", [...OPEN_CASE_STATUSES])
    .order("id", { ascending: true });
  const rows = await readCompletePages(async (from, to) => await query.range(from, to), {
    label: "Digest cases",
  });
  return rows.flatMap((raw) => {
    const row = record(raw);
    const id = text(row?.id);
    if (!row || !id || row.org_id !== orgId || typeof row.case_number !== "number") return [];
    // The provider is the case's own; the org check is belt and braces under
    // the service key.
    const provider = record(row.providers);
    const providerName =
      provider && provider.org_id === orgId
        ? [text(provider.first_name), text(provider.last_name)]
            .map((part) => part?.trim() ?? "")
            .filter(Boolean)
            .join(" ")
        : "";
    const payer = record(row.payers);
    const avg = payer?.avg_decision_days;
    return [
      {
        id,
        caseNumber: row.case_number,
        assignedTo: text(row.assigned_to),
        caseStatus: text(row.case_status) ?? "",
        submittedDate: text(row.submitted_date),
        providerName: providerName || UNKNOWN_PROVIDER,
        payerName: text(payer?.name)?.trim() || UNKNOWN_PAYER,
        avgDecisionDays: typeof avg === "number" ? avg : null,
      },
    ];
  });
}

async function listTouchpoints(
  ctx: FollowUpDigestReadCtx,
  orgId: string,
): Promise<DigestTouchpoint[]> {
  const query = ctx.db
    .from("touches")
    .select(DIGEST_TOUCH_COLUMNS, { count: "exact" })
    .eq("org_id", orgId)
    .eq("entry_type", "touchpoint")
    .order("id", { ascending: true });
  const rows = await readCompletePages(async (from, to) => await query.range(from, to), {
    label: "Digest touchpoints",
  });
  return rows.flatMap((raw) => {
    const row = record(raw);
    const id = text(row?.id);
    const caseId = text(row?.case_id);
    const touchDate = text(row?.touch_date);
    if (!row || !id || !caseId || !touchDate) return [];
    return [
      {
        id,
        caseId,
        touchDate,
        // The touches service's fallback for a row with no created_at.
        createdAt: text(row.created_at) ?? touchDate,
        nextFollowUpDate: text(row.next_follow_up_date),
        clearsFollowUp: row.clears_follow_up === true,
      },
    ];
  });
}

/** Everything the digest needs for one org, each read scoped to that org. */
export async function loadFollowUpDigestOrgData(
  ctx: FollowUpDigestReadCtx,
  orgId: string,
): Promise<FollowUpDigestOrgData> {
  const members = await listMembers(ctx, orgId);
  const cases = await listOpenCases(ctx, orgId);
  const touchpoints = await listTouchpoints(ctx, orgId);
  return { members, cases, touchpoints };
}
