# SendGrid email service

Status: built, not yet verified against a real SendGrid key. Branch `ivan/sendgrid-email-service` (off `main` a5aceefe).

## Why

Provider onboarding (the Oct 19 handoff in `req/`) needs Minted to send email: invitations, 6-digit sign-in codes, submission confirmations, and later reminders. Main has no transactional mailer. The only email path today is GoTrue's staff invite (`supabase/functions/invite-member`). The `send-email` edge function on the `onboarding-r1` branch let any signed-in user send any text to any address, so it is not reused.

This change builds the reusable sending layer only. Features add their own templates and callers later.

## Decisions

| Decision         | Choice                                                                  | Why                                                                                                            |
| ---------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Runtime          | Server-only module in `src/server/email/` (Node, Vercel)                | The first callers are `/api` routes beside `guard.ts`. Testable in vitest and CI. Not a Supabase edge function |
| Scope            | Module, closed template registry, one `test` template, local CLI        | No `/api` route, so no isolation-gate change                                                                   |
| Caller input     | A registered template key plus typed data. No free-form subject or body | Prevents an open relay and stray PHI in bodies, and keeps the spec's copy rules in one place                   |
| Template storage | Typed render functions in git                                           | Reviewed and versioned. A later move (e.g. SendGrid Dynamic Templates) changes only `templates.ts`             |
| Reply-to         | Required on every send                                                  | Spec: replies reach a person                                                                                   |
| Audit row        | Written by the caller, not the module                                   | The caller has the org and entity. The module has no database access                                           |
| CLI default      | Sandbox unless `--live`                                                 | A stray run or typo never delivers real mail                                                                   |
| Deployed default | Delivers; `SENDGRID_SANDBOX=true` opts an environment into sandbox      | Only internal users exist pre-launch, so one fewer var to set                                                  |

## Rules every send follows

From spec §4.5 and §9:

- Sender display name is `"<Practice> via Minted Panel"`. The From address is always Minted's authenticated domain, never the practice's.
- A reply-to that reaches a person is required.
- All tracking is off: open, click (including plain-text links), subscription, ganalytics. Click tracking would also rewrite token links through SendGrid's domain.
- The recipient always comes from a server-side lookup in the caller, never from request input.
- Nothing is logged: no recipients, names, subjects, bodies, tokens, API key or SendGrid responses.

## Files

| File                                | Responsibility                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/server/email/templates.ts`     | `TemplateDataMap` (one entry, `test: { practiceName: string }`), the `TEMPLATES` record of pure render functions returning `{ subject, text, html }`, and `escapeHtml`                                                                                                                                       |
| `src/server/email/env.ts`           | `resolveEmailEnv()` returns `{ apiKey?, fromEmail?, fromName, sandbox }` from `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME` (default `"Minted Panel"`) and `SENDGRID_SANDBOX` (sandbox only when exactly `"true"`). Values are trimmed. Copies the `pick` pattern from `src/server/env.ts` |
| `src/server/email/sendgrid.ts`      | `sendEmail(input, deps?)`, `buildMailPayload` (exported for tests), and `EmailError` with `kind` and optional `status`                                                                                                                                                                                       |
| `src/server/email/sendgrid.test.ts` | vitest with an injected `fetch` and an explicit `env`                                                                                                                                                                                                                                                        |
| `scripts/email/send-test.ts`        | Local CLI                                                                                                                                                                                                                                                                                                    |

**Node type-stripping constraint.** The CLI runs on Node 22.22's built-in TypeScript stripping, so no new dependency is needed. Every file the CLI imports must:

- use relative `.ts` imports only, never `@/`;
- use `import type` for type-only imports, because Node does not know which imports are types;
- use erasable syntax only: no enums, namespaces or parameter properties.

`tsconfig.json` `include` covers only `src/**`. Add `"scripts/email/**/*.ts"` so `npx tsc --noEmit` checks the CLI. ESLint already covers `**/*.ts`.

## `sendEmail`

```ts
type EmailErrorKind = "misconfigured" | "invalid_input" | "provider_rejected" | "network";

sendEmail<K extends TemplateKey>(
  input: {
    to: string;
    template: K;
    data: TemplateDataMap[K];
    practiceName?: string;
    replyTo: { email: string; name?: string };
  },
  deps?: { fetch?: typeof fetch; env?: EmailEnv; timeoutMs?: number },
): Promise<{ status: number; messageId: string | null; sandbox: boolean }>
```

1. **Config check first.** A missing key or from-address throws `misconfigured`, naming only the missing variable, before any fetch. Callers map it to 500, never 401.
2. **Validate addresses.** `to` and `replyTo.email`: trimmed, at most 254 characters, no whitespace or CR/LF, a simple `local@domain.tld` match excluding `<>",;`. Otherwise `invalid_input`. Errors never echo the rejected value.
3. **Clean display names.** One `cleanName` helper for every display name (`from.name`, including env `SENDGRID_FROM_NAME`, and `reply_to.name`). It turns `[\u0000-\u001F\u007F-\u009F]` into spaces, removes `<>"`, collapses whitespace and caps at 64 code points (never splitting an emoji). An empty practice name falls back to `fromName`, and an empty `fromName` to `"Minted Panel"`. The subject goes through the same `cleanName` with a 200 cap, so a subject template must not rely on `<`, `>` or `"`.
4. **Build the payload** for `POST https://api.sendgrid.com/v3/mail/send`:
   ```json
   {
     "personalizations": [{ "to": [{ "email": "<to>" }] }],
     "from": { "email": "<SENDGRID_FROM_EMAIL>", "name": "<Practice> via Minted Panel" },
     "reply_to": { "email": "<replyTo.email>", "name": "<replyTo.name>" },
     "subject": "<rendered>",
     "content": [
       { "type": "text/plain", "value": "<rendered>" },
       { "type": "text/html", "value": "<rendered>" }
     ],
     "tracking_settings": {
       "click_tracking": { "enable": false, "enable_text": false },
       "open_tracking": { "enable": false },
       "subscription_tracking": { "enable": false },
       "ganalytics": { "enable": false }
     },
     "mail_settings": { "sandbox_mode": { "enable": "<env.sandbox>" } },
     "categories": ["<template>"],
     "custom_args": { "template": "<template>" }
   }
   ```
   `text/plain` must come before `text/html`. Categories and custom args carry the template key only, never PHI.
5. **Timeout.** `signal: AbortSignal.timeout(timeoutMs ?? 10_000)`, so a hung call can't hold a Vercel function to its platform limit. An abort becomes `network`.
6. **Result.**
   - 2xx (202 live, 200 in sandbox) returns `{ status, messageId: headers.get("x-message-id"), sandbox }`.
   - Non-2xx throws `provider_rejected` with the status. The body is discarded and never attached.
   - A thrown `fetch` becomes `network`. The original error is not attached.
   - No retries in the module.
7. **The module logs nothing.**

### Caller contract

Document this at the top of `sendgrid.ts` and in CLAUDE.md:

- **At-least-once.** SendGrid `/mail/send` has no idempotency key. Callers persist the code or invite attempt before sending, rate-limit, and never regenerate or resend on a retried request.
- **Audit.** Callers write the "email sent" audit row through their own `ctx.writeAudit`, with org, entity, template key and `messageId`, never the recipient or body.
- **Sender domain.** `SENDGRID_FROM_EMAIL` must be on Minted's SendGrid-authenticated (DMARC-aligned) domain. The practice appears only in the display name and the reply-to.

## CLI

```
npm run email:send-test -- --to you@example.com [--reply-to a@b.com] [--practice "Acme Health"] [--live]
```

npm script: `"email:send-test": "node --env-file-if-exists=.env scripts/email/send-test.ts"`. Needs Node 22.18 or later (unflagged type stripping); `engines` says only `22.x`.

- Parses arguments with `util.parseArgs` from `node:util`.
- Without `--to`, or with an unknown option, prints usage to stderr and exits 2. There is never a default recipient.
- `--reply-to` defaults to `SENDGRID_FROM_EMAIL`.
- Forces sandbox unless `--live` is passed, whatever `SENDGRID_SANDBOX` says.
- Prints only `sandbox: on|off`, `status: <actual>` and `x-message-id: …`. On failure prints `error: <kind> [status]` and exits 1. Uses `process.stdout.write`.

## Environment

Local keys go in the root `.env`, which is gitignored. Non-`VITE_` variables are never baked into the browser bundle (`vite.config.ts` loads only the `VITE_` prefix).

| Variable              | Required | Notes                                                            |
| --------------------- | -------- | ---------------------------------------------------------------- |
| `SENDGRID_API_KEY`    | yes      | Restricted key, Mail Send only                                   |
| `SENDGRID_FROM_EMAIL` | yes      | On Minted's authenticated domain                                 |
| `SENDGRID_FROM_NAME`  | no       | Default `Minted Panel`                                           |
| `SENDGRID_SANDBOX`    | no       | Only `true` validates without delivering; anything else delivers |

Deployed: Vercel env vars per project, staging first. An operator sets these; the PR doesn't.

## Tests (`sendgrid.test.ts`)

1. Missing `apiKey` or `fromEmail` throws `misconfigured`, and fetch is not called.
2. Happy path returns `{ status: 202, messageId }`, with the correct URL, POST and `Authorization: Bearer`.
3. Payload: text/plain before text/html, every tracking flag false, and categories and custom args hold only the template key.
4. `sandbox: true|false` is reflected in `mail_settings.sandbox_mode.enable`.
5. `practiceName: 'Ac"me\r\nBcc: x'` comes out as one line with no quotes, ends in ` via Minted Panel`, at most 64 characters. Empty gives `"Minted Panel"`.
6. The test template HTML-escapes `<script>`, and the subject has no newline.
7. `to` of `"a@b.com\r\nbcc:c@d.com"`, `"nope"` or `""`, and a bad reply-to, throw `invalid_input` without calling fetch.
8. A 400 whose body contains a recipient throws `provider_rejected` with status 400. Neither `message` nor `String(err)` contains the body or the recipient.
9. A rejected fetch throws `network`, and the message excludes the original error text.
10. A fetch that never resolves, with `timeoutMs: 10`, throws `network`.
11. `replyTo.name` and env `fromName` containing `\r\n`, `"` or `\u0085` are cleaned the same way as the practice name.
12. A 200 sandbox response returns `{ status: 200, sandbox: true }`, and the payload has `click_tracking.enable_text: false`.

## Docs to update

- `.env.example`: the four `SENDGRID_*` variables, marked server-only and never `VITE_`, with sandbox explained.
- `CLAUDE.md`, under "Server API layer": a short "Email" subsection covering the module path, the closed registry (a feature adds its own template), the recipient coming from a server lookup, tracking off, `misconfigured` mapping to 500, nothing logged, and the CLI command.
- `docs/VERIFY.md`: one line, run the CLI in sandbox for email changes.

## Build order

1. `templates.ts`, then `env.ts`.
2. `sendgrid.ts`, then `sendgrid.test.ts`. Run `npx vitest run src/server/email`.
3. `scripts/email/send-test.ts`, the npm script and the `tsconfig.json` include.
4. Docs.
5. `npx tsc --noEmit`, `npm run lint`, `npx prettier --check src/server/email scripts/email docs/sendgrid-email.md`.

## Verification

1. `npx vitest run src/server/email`: 18 tests pass.
2. Type check, lint and prettier are clean.
3. Add `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` to `.env`.
4. `npm run email:send-test -- --to <your address>` prints `sandbox: on` and `status: 200`, and nothing appears in SendGrid Activity. This proves the key, sender authentication and payload.
5. Repeat with `--live`. Expect `status: 202` and the email arriving. In the raw headers, check that From shows `Minted Panel`, there's no tracking pixel, and links aren't rewritten.

## Not in this change

- The delivery-event webhook (the spec's "delivery reporting").
- Audit rows. Callers write them.
- Any `/api` route.
- Real templates: invitation, sign-in code, confirmation. They ship with their features.
