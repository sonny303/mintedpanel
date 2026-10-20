// 2026-10-20 — send-email edge function (Deno). Mirrors the structure of
// supabase/functions/invite-member/index.ts: CORS, JWT, JSON payload, audit.
// Sends via SendGrid v3 mail/send. The template-rendering helper (templates
// map) is a TODO — kept minimal here so the routing shape is right; the
// 11 templates land in src/emails/*.ts in a follow-up.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

interface Payload {
  template_id?: unknown;
  to?: unknown;
  practice_name?: unknown;
  data?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const sendgridKey = Deno.env.get("SENDGRID_API_KEY");
  const fromEmail = Deno.env.get("SENDGRID_FROM_EMAIL");
  const fromDomain = Deno.env.get("SENDGRID_FROM_DOMAIN");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Server not configured" });
  if (!sendgridKey || !fromEmail || !fromDomain) return json(500, { error: "Email service not configured" });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "Missing auth token" });

  let payload: Payload;
  try { payload = (await req.json()) as Payload; } catch { return json(400, { error: "Invalid JSON body" }); }
  const templateId = typeof payload.template_id === "string" ? payload.template_id : "";
  const to = typeof payload.to === "string" ? payload.to : "";
  const practiceName = typeof payload.practice_name === "string" ? payload.practice_name : "Minted Panel";
  if (!templateId || !to) return json(400, { error: "template_id and to are required" });

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const userResp = await supabase.auth.getUser(token);
  if (userResp.error || !userResp.data.user) return json(401, { error: "Invalid auth token" });
  const actorId = userResp.data.user.id;

  // TODO: render template from src/emails/<id>.ts.
  const subject = `[${practiceName}] ${templateId}`;
  const text = `Hi,\n\nThis is a placeholder for the "${templateId}" template from ${practiceName}.\n\n— Minted Panel`;

  const sendgridResp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${sendgridKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }], subject }],
      from: { email: fromEmail, name: `${practiceName} via Minted Panel` },
      reply_to: { email: `noreply@${fromDomain}` },
      content: [{ type: "text/plain", value: text }],
    }),
  });
  if (!sendgridResp.ok) {
    const errText = await sendgridResp.text();
    return json(502, { error: "SendGrid rejected the send", detail: errText.slice(0, 500) });
  }

  await supabase.from("audit_log").insert({
    org_id: null, user_id: actorId, action_type: "CREATE", entity_type: "email_send",
    entity_id: null, description: `Sent ${templateId} email to ${to}`,
  });

  return json(200, { ok: true, template_id: templateId, to });
});
