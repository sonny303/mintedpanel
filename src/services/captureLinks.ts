// Secure one-time data capture link service (redesign E0.5).
//
// Two audiences share this file:
//   - OPERATOR (authenticated): read the org's current link state (browser RLS)
//     and issue/re-issue a link via the SECURITY DEFINER create_capture_link RPC.
//   - RECIPIENT (unauthenticated, public /capture/:token route): validate + submit
//     via the anon SECURITY DEFINER RPCs. These deliberately do NOT call
//     requireActiveOrg — there is no session (BD-1: token link, no login).
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";
import type { CaptureLink, CaptureTokenView, ContactInput, IssuedCaptureLink } from "@/types";
import { composeFullName, splitFullName } from "@/lib/personName";

// `supabase.rpc` must be called bound (CLAUDE.md gotcha). One loose signature
// reused for every RPC in this file.
function boundRpc() {
  return supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

// Operator: the active org's most recent capture link (drives the status surface
// — none / active-until / used / expired). RLS scopes reads to the caller's orgs.
export async function getCaptureLink(): Promise<CaptureLink | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("party_capture_links")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<CaptureLink>(data) : null;
}

export interface IssueCaptureLinkInput {
  recipientEmail: string;
  /** An existing party (owner/customer/…) to top up, or null to provision an
   *  ad-hoc recipient party bound to the email. */
  partyId?: string | null;
  /** Name for a provisioned ad-hoc party; ignored when partyId is given. */
  recipientName?: string;
}

// Operator: issue (or re-issue — the RPC revokes any prior active link) a link.
// Returns the raw token ONCE for URL + email assembly; it is never persisted.
export async function issueCaptureLink(input: IssueCaptureLinkInput): Promise<IssuedCaptureLink> {
  const orgId = requireActiveOrg();
  const email = input.recipientEmail.trim();
  if (!email) throw new Error("Recipient email is required");
  const { data, error } = await boundRpc()("create_capture_link", {
    p_org_id: orgId,
    p_party_id: input.partyId ?? null,
    p_recipient_email: email,
    p_recipient_name: input.recipientName?.trim() || null,
  });
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    token: row.token as string,
    partyId: row.party_id as string,
    recipientEmail: row.recipient_email as string,
    recipientName: row.recipient_name as string,
    orgName: row.org_name as string,
    expiresAt: row.expires_at as string,
  };
}

// Recipient (anon): what the public route learns about a token. Never leaks any
// org beyond the single authorized one; unknown token → { state: 'invalid' }.
export async function validateCaptureToken(token: string): Promise<CaptureTokenView> {
  const { data, error } = await boundRpc()("validate_capture_token", { p_token: token });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  const current = row.current as Record<string, unknown> | undefined;
  return {
    state: row.state as CaptureTokenView["state"],
    orgName: (row.org_name as string) ?? undefined,
    recipientName: (row.recipient_name as string) ?? undefined,
    recipientEmail: (row.recipient_email as string) ?? undefined,
    expiresAt: (row.expires_at as string) ?? undefined,
    current: current ? currentToContact(current) : undefined,
  };
}

// Recipient (anon): overwrite the authorized party. Server enforces completeness
// + single-use; returns whether the write landed and the resulting link state.
export async function submitCapture(
  token: string,
  contact: ContactInput,
): Promise<{ ok: boolean; state: CaptureTokenView["state"] }> {
  const payload: Record<string, unknown> = {
    // The RPC still requires a composed `name` (assert_contact_valid); the split
    // halves ride alongside it so submit_capture persists them (D6).
    name: composeFullName(contact),
    first_name: contact.firstName.trim(),
    last_name: contact.lastName.trim(),
    title: contact.title?.trim() || null,
    email: contact.email.trim(),
    phone_office: contact.phoneOffice.trim(),
    phone_extension: contact.phoneExtension?.trim() || null,
    phone_mobile: contact.phoneMobile?.trim() || null,
    fax: contact.fax?.trim() || null,
    address_line1: contact.addressLine1.trim(),
    address_line2: contact.addressLine2?.trim() || null,
    city: contact.city.trim(),
    state: contact.state.trim(),
    postal_code: contact.postalCode.trim(),
    country: contact.country?.trim() || null,
  };
  const { data, error } = await boundRpc()("submit_capture", {
    p_token: token,
    p_payload: payload,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return { ok: Boolean(row.ok), state: row.state as CaptureTokenView["state"] };
}

// The RPC's snake_case `current` block → an editable ContactInput (empty strings,
// not null) so the recipient's form prefills with any data already on file.
function currentToContact(c: Record<string, unknown>): ContactInput {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  // A party captured before the D6 split has no first/last on file — split its
  // display name so the recipient's form opens populated rather than blank.
  const split = splitFullName(s(c.name));
  return {
    firstName: s(c.first_name) || split.firstName,
    lastName: s(c.last_name) || split.lastName,
    title: s(c.title),
    email: s(c.email),
    phoneOffice: s(c.phone_office),
    phoneExtension: s(c.phone_extension),
    phoneMobile: s(c.phone_mobile),
    fax: s(c.fax),
    addressLine1: s(c.address_line1),
    addressLine2: s(c.address_line2),
    city: s(c.city),
    state: s(c.state),
    postalCode: s(c.postal_code),
    country: s(c.country) || "US",
  };
}
