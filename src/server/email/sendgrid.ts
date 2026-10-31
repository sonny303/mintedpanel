// Sends one templated email through SendGrid v3 /mail/send.
//
// Caller contract:
// - `to` comes from the caller's server-side lookup (an intake link, a
//   membership row), never from request input. This module trusts it.
// - Delivery is at-least-once and SendGrid has no idempotency key. Persist the
//   code or invite attempt before sending, rate-limit, and never regenerate or
//   resend on a retried request.
// - The caller writes the "email sent" audit row with its own org context
//   (template key + messageId, never the recipient or body). A scheduled job
//   has no actor for audit_log, so it records each send in notification_sends
//   instead (src/server/jobs/notificationSends.ts): org, recipient user id,
//   slot and messageId, never the address or body.
// - Map EmailError kind "misconfigured" to 500, never 401.
//
// This module logs nothing. Tracking is always off: click tracking would
// rewrite sign-in links through SendGrid's domain.
import { resolveEmailEnv } from "./env.ts";
import type { EmailEnv } from "./env.ts";
import { TEMPLATES } from "./templates.ts";
import type { TemplateDataMap, TemplateKey } from "./templates.ts";

const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";
const DEFAULT_TIMEOUT_MS = 10_000;
const FROM_SUFFIX = " via Minted Panel";
const MAX_NAME = 64;
const MAX_SUBJECT = 200;
// Matching control characters is the point: they would split a mail header.
/* eslint-disable no-control-regex */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
const EMAIL_PATTERN =
  /^[^\s@<>",;\u0000-\u001F\u007F-\u009F]+@[^\s@<>",;\u0000-\u001F\u007F-\u009F]+\.[^\s@<>",;\u0000-\u001F\u007F-\u009F]+$/;
/* eslint-enable no-control-regex */

export type EmailErrorKind = "misconfigured" | "invalid_input" | "provider_rejected" | "network";

export class EmailError extends Error {
  kind: EmailErrorKind;
  status?: number;

  constructor(kind: EmailErrorKind, message: string, status?: number) {
    super(message);
    this.name = "EmailError";
    this.kind = kind;
    this.status = status;
  }
}

export interface SendEmailInput<K extends TemplateKey> {
  to: string;
  template: K;
  data: TemplateDataMap[K];
  practiceName?: string;
  replyTo: { email: string; name?: string };
}

export interface SendEmailDeps {
  fetch?: typeof fetch;
  env?: EmailEnv;
  timeoutMs?: number;
}

export interface SendEmailResult {
  status: number;
  messageId: string | null;
  sandbox: boolean;
}

// Display names end up in mail headers downstream (From, Reply-To). Returns a
// single line safe to place there, at most `max` code points; may be "".
export function cleanName(value: string, max: number = MAX_NAME): string {
  const line = value.replace(CONTROL_CHARS, " ").replace(/[<>"]/g, "").replace(/\s+/g, " ").trim();
  return Array.from(line).slice(0, max).join("").trim();
}

// Exported so callers can reject an address up front, before writing anything.
export function isEmailAddress(value: string): boolean {
  if (value.length === 0 || value.length > 254 || !EMAIL_PATTERN.test(value)) return false;
  // No empty labels or edge dots: SendGrid would reject these after the
  // invite had already been saved.
  const [local, domain] = value.split("@");
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  return domain.split(".").every((l) => l.length > 0 && !l.startsWith("-") && !l.endsWith("-"));
}

function checkAddress(value: string, kind: EmailErrorKind, label: string): string {
  const email = value.trim();
  if (!isEmailAddress(email)) {
    throw new EmailError(kind, `${label} is not a valid email address`);
  }
  return email;
}

function fromName(practiceName: string | undefined, env: EmailEnv): string {
  const practice = cleanName(practiceName ?? "", MAX_NAME - FROM_SUFFIX.length);
  return practice ? practice + FROM_SUFFIX : cleanName(env.fromName) || "Minted Panel";
}

export function buildMailPayload<K extends TemplateKey>(input: SendEmailInput<K>, env: EmailEnv) {
  const fromEmail = checkAddress(env.fromEmail ?? "", "misconfigured", "SENDGRID_FROM_EMAIL");
  const to = checkAddress(input.to, "invalid_input", "Recipient");
  const replyToEmail = checkAddress(input.replyTo.email, "invalid_input", "Reply-to");
  const replyToName = cleanName(input.replyTo.name ?? "");
  const rendered = TEMPLATES[input.template](input.data);
  const subject = cleanName(rendered.subject, MAX_SUBJECT);

  return {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromEmail, name: fromName(input.practiceName, env) },
    reply_to: replyToName ? { email: replyToEmail, name: replyToName } : { email: replyToEmail },
    subject,
    content: [
      { type: "text/plain", value: rendered.text },
      { type: "text/html", value: rendered.html },
    ],
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
      subscription_tracking: { enable: false },
      ganalytics: { enable: false },
    },
    mail_settings: { sandbox_mode: { enable: env.sandbox } },
    categories: [input.template],
    custom_args: { template: input.template },
  };
}

export async function sendEmail<K extends TemplateKey>(
  input: SendEmailInput<K>,
  deps: SendEmailDeps = {},
): Promise<SendEmailResult> {
  const env = deps.env ?? resolveEmailEnv();
  const missing: string[] = [];
  if (!env.apiKey) missing.push("SENDGRID_API_KEY");
  if (!env.fromEmail) missing.push("SENDGRID_FROM_EMAIL");
  if (missing.length > 0) {
    throw new EmailError("misconfigured", `Email not configured: missing ${missing.join(", ")}`);
  }

  const payload = buildMailPayload(input, env);
  const doFetch = deps.fetch ?? fetch;

  let response: Response;
  try {
    response = await doFetch(SENDGRID_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new EmailError("network", "SendGrid request failed");
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new EmailError(
      "provider_rejected",
      `SendGrid rejected the send (${response.status})`,
      response.status,
    );
  }

  await response.body?.cancel().catch(() => undefined);
  return {
    status: response.status,
    messageId: response.headers.get("x-message-id"),
    sandbox: env.sandbox,
  };
}
