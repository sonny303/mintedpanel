// MINT-108 — the per-org reads behind the daily follow-up digest job
// (src/server/jobs/followupDigestRun.ts).
//
// Server-only surface, like ./orgMemberships.ts: there is no browser-default
// ctx, because the caller holds the service-role client, which bypasses RLS.
// Tenant isolation is this file's job. The job's one cross-org read (which
// orgs have the digest on, and their settings) is
// listEnabledNotificationSequences in ./notificationSequences.ts; everything
// here serves one org and is filtered by it, and a case's embedded provider
// is used only when it belongs to that org. `profiles` and `payers` have no
// org column: profiles arrive embedded in the org's memberships, payers (a
// global catalog) embedded in the org's cases.
//
// PHI: narrowed column lists, mapped field by field, so a column the select
// did not name cannot ride along. The provider's first and last name are the
// only provider columns read; touches are read for their follow-up fields,
// never `notes`. No at-risk flag, so no submitted date and no payer decision
// days (MINT-111 brings those back).
//
// Touches: only those of the org's open cases (in chunks of
// DIGEST_TOUCH_CASE_CHUNK ids, which keeps each URL short and each read far
// under readCompletePages' row limit), and only those that set or clear a
// follow-up (DIGEST_TOUCH_FILTER). resolveActiveFollowUp skips a touch with
// neither, so leaving those out yields the same active follow-up
// (touchCanResolveFollowUp in src/lib/followUpDigest.ts, pinned by its test).
//
// Complete reads: hosted PostgREST caps a response at 1,000 rows and says
// nothing, so every list that can grow runs through readCompletePages with an
// exact count and a stable order. The org's own row is a primary-key read.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { OPEN_CASE_STATUSES } from "@/lib/caseStatus";
import { readCompletePages } from "@/lib/completePages";
import type { DigestCase, DigestMember, DigestTouchpoint } from "@/lib/followUpDigest";

export interface FollowUpDigestReadCtx {
  db: SupabaseClient<Database>;
}

export interface FollowUpDigestOrgData {
  /** The org's name, for the email's sign-off; "" when it has none. */
  practiceName: string;
  members: DigestMember[];
  /** The org's open cases, with display-ready provider and payer names. */
  cases: DigestCase[];
  /** The open cases' touchpoints that set or clear a follow-up, follow-up
   *  fields only. */
  touchpoints: DigestTouchpoint[];
}

export const DIGEST_ORG_COLUMNS = "id, name";
export const DIGEST_MEMBER_COLUMNS = "id, user_id, created_at, profiles(first_name, email)";
export const DIGEST_CASE_COLUMNS =
  "id, org_id, case_number, assigned_to, case_status, providers(org_id, first_name, last_name), payers(name)";
export const DIGEST_TOUCH_COLUMNS =
  "id, case_id, touch_date, created_at, next_follow_up_date, clears_follow_up";
/** PostgREST's spelling of touchCanResolveFollowUp. */
export const DIGEST_TOUCH_FILTER = "next_follow_up_date.not.is.null,clears_follow_up.is.true";
/** Open case ids per touches read. */
export const DIGEST_TOUCH_CASE_CHUNK = 100;

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

async function readPracticeName(ctx: FollowUpDigestReadCtx, orgId: string): Promise<string> {
  const { data, error } = await ctx.db
    .from("organizations")
    .select(DIGEST_ORG_COLUMNS)
    .eq("id", orgId);
  if (error) throw error;
  const row = (Array.isArray(data) ? data : []).map(record).find((r) => r?.id === orgId);
  return text(row?.name)?.trim() ?? "";
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
    return [{ userId, firstName: text(profile?.first_name), email: text(profile?.email) }];
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
    return [
      {
        id,
        caseNumber: row.case_number,
        assignedTo: text(row.assigned_to),
        caseStatus: text(row.case_status) ?? "",
        providerName: providerName || UNKNOWN_PROVIDER,
        payerName: text(payer?.name)?.trim() || UNKNOWN_PAYER,
      },
    ];
  });
}

async function listTouchpoints(
  ctx: FollowUpDigestReadCtx,
  orgId: string,
  caseIds: readonly string[],
): Promise<DigestTouchpoint[]> {
  const rows: unknown[] = [];
  for (let start = 0; start < caseIds.length; start += DIGEST_TOUCH_CASE_CHUNK) {
    const query = ctx.db
      .from("touches")
      .select(DIGEST_TOUCH_COLUMNS, { count: "exact" })
      .eq("org_id", orgId)
      .eq("entry_type", "touchpoint")
      .in("case_id", caseIds.slice(start, start + DIGEST_TOUCH_CASE_CHUNK))
      .or(DIGEST_TOUCH_FILTER)
      .order("id", { ascending: true });
    rows.push(
      ...(await readCompletePages(async (from, to) => await query.range(from, to), {
        label: "Digest touchpoints",
      })),
    );
  }
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
  const practiceName = await readPracticeName(ctx, orgId);
  const members = await listMembers(ctx, orgId);
  const cases = await listOpenCases(ctx, orgId);
  const touchpoints = await listTouchpoints(
    ctx,
    orgId,
    cases.map((c) => c.id),
  );
  return { practiceName, members, cases, touchpoints };
}
