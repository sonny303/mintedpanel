// Sends one registered template with sample data (default `test`). Sandbox
// (validated, never delivered) unless --live is passed, whatever
// SENDGRID_SANDBOX says.
//
//   npm run email:send-test -- --to you@example.com [--template provider_invitation] [--reply-to a@b.com] [--practice "Acme Health"] [--live]
import { parseArgs } from "node:util";
import { resolveEmailEnv } from "../../src/server/email/env.ts";
import { EmailError, sendEmail } from "../../src/server/email/sendgrid.ts";
import type { TemplateDataMap, TemplateKey } from "../../src/server/email/templates.ts";

const USAGE =
  'usage: npm run email:send-test -- --to <address> [--template test|provider_invitation|intake_code|followup_digest_daily] [--reply-to <address>] [--practice "<name>"] [--live]\n';

let values;
try {
  ({ values } = parseArgs({
    options: {
      to: { type: "string" },
      template: { type: "string" },
      "reply-to": { type: "string" },
      practice: { type: "string" },
      live: { type: "boolean", default: false },
    },
  }));
} catch {
  process.stderr.write(USAGE);
  process.exit(2);
}

if (!values.to) {
  process.stderr.write(USAGE);
  process.exit(2);
}

// A const copy keeps the parsed type inside send() below.
const args = values;
const env = { ...resolveEmailEnv(), sandbox: !args.live };
const practiceName = values.practice ?? "Minted Panel";

// Sample data only: the invitation link points nowhere real.
const SAMPLES: { [K in TemplateKey]: TemplateDataMap[K] } = {
  test: { practiceName },
  provider_invitation: {
    practiceName,
    firstName: "Anita",
    link: "https://example.invalid/intake/sample-token",
  },
  intake_code: { practiceName, code: "123456" },
  // Synthetic rows: no real provider, payer or case.
  followup_digest_daily: {
    practiceName,
    recipientFirstName: "Anita",
    digestDate: "2026-10-31",
    workQueueLink: "https://example.invalid/work",
    own: {
      rows: [
        {
          caseNumber: 1001,
          caseLink: "https://example.invalid/cases/sample-case",
          providerName: "Sample Provider",
          payerName: "Sample Payer",
          dueDate: "2026-10-28",
          status: "overdue",
          atRisk: { daysSinceSubmission: 62, avgDecisionDays: 45 },
        },
      ],
      more: 0,
      overdue: 1,
      dueToday: 0,
      atRisk: 1,
    },
    unassigned: { rows: [], more: 0, overdue: 0, dueToday: 0, atRisk: 0 },
    team: [],
  },
};

const template = (values.template ?? "test") as TemplateKey;
if (!Object.hasOwn(SAMPLES, template)) {
  process.stderr.write(USAGE);
  process.exit(2);
}

function send<K extends TemplateKey>(key: K, to: string) {
  return sendEmail(
    {
      to,
      template: key,
      data: SAMPLES[key],
      practiceName: args.practice,
      replyTo: { email: args["reply-to"] ?? env.fromEmail ?? "" },
    },
    { env },
  );
}

try {
  const result = await send(template, values.to);
  process.stdout.write(`sandbox: ${result.sandbox ? "on" : "off"}\n`);
  process.stdout.write(`status: ${result.status}\n`);
  process.stdout.write(`x-message-id: ${result.messageId ?? "(none)"}\n`);
} catch (err) {
  if (!(err instanceof EmailError)) throw err;
  const status = err.status ? ` ${err.status}` : "";
  process.stdout.write(`error: ${err.kind}${status}\n`);
  if (err.kind === "misconfigured") process.stdout.write(`${err.message}\n`);
  process.exit(1);
}
