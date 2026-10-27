// Sends the `test` template once. Sandbox (validated, never delivered) unless
// --live is passed, whatever SENDGRID_SANDBOX says.
//
//   npm run email:send-test -- --to you@example.com [--reply-to a@b.com] [--practice "Acme Health"] [--live]
import { parseArgs } from "node:util";
import { resolveEmailEnv } from "../../src/server/email/env.ts";
import { EmailError, sendEmail } from "../../src/server/email/sendgrid.ts";

const USAGE =
  'usage: npm run email:send-test -- --to <address> [--reply-to <address>] [--practice "<name>"] [--live]\n';

let values;
try {
  ({ values } = parseArgs({
    options: {
      to: { type: "string" },
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

const env = { ...resolveEmailEnv(), sandbox: !values.live };
const practiceName = values.practice ?? "Minted Panel";

try {
  const result = await sendEmail(
    {
      to: values.to,
      template: "test",
      data: { practiceName },
      practiceName: values.practice,
      replyTo: { email: values["reply-to"] ?? env.fromEmail ?? "" },
    },
    { env },
  );
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
