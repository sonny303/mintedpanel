# Provider onboarding slice 1: invite → email → code → form

Status: built, Oct 25, 2026, on branch `ivan/provider-onboarding-ui`; revised after a Fable review, a zen (gpt-5.5) review and two review rounds on the build. The migration is not applied anywhere yet (§9). Builds on `r1-ui-spec.md` (decisions 1–21) and the SendGrid module (`docs/sendgrid-email.md`).

## 1. Goal

A Minted staff user invites a provider. The provider receives a real email, signs in with a 6-digit code, and lands on the consent and form screens showing her name. It runs on staging.

**Who it's for.** The PM and staff, so they can demo the real way in end to end. This is the first point where something leaves the building and a provider actually gets in.

**Not in this slice:**

- saving form answers;
- the SSN and login vault;
- documents;
- the coordinator Onboarding card;
- the practice New hires screen;
- reminders.

Those screens stay on the preview plan (`r1-ui-spec.md`).

## 2. Decisions this slice rests on

| #   | Decision                                                                                                                                                                                                                                        | Source                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| S1  | A **staff** user (admin or specialist, `isWriter`) presses Invite on `/providers`. This is temporary: canvas board 6a says "no coordinator invite", and the practice's own Invite follows once practice logins exist                            | Oct 25 answer; `src/routes/providers.index.tsx:337` |
| S2  | Real sending comes first on this path. The other screens stay preview-first                                                                                                                                                                     | Oct 25 answer                                       |
| S3  | The email link carries an opaque **invite** token. The **session** granted after the code is an `HttpOnly` cookie, never in the URL or in browser storage                                                                                       | decision 20                                         |
| S4  | Invite and intake go through new `/api` routes, because the email module runs on the server and the provider has no Supabase login                                                                                                              | `src/server/email/*`; R1.14                         |
| S5  | Every multi-step write is one `SECURITY DEFINER` RPC, callable only by `service_role`. Supabase-js can't reach a non-`public` schema (nothing in `src/` calls `.schema()`), and multi-call PostgREST writes can't be atomic                     | Fable H1, H3; zen                                   |
| S6  | The code is always sent to the **invited** address. The provider doesn't type her email. The identify screen shows the address (the SSN link already returns `recipient_email`), which removes both the timing difference and a pointless input | Fable L2; `20260717120100_ssn_intake_links.sql`     |

## 3. The flow

1. **Staff invites.** Staff opens `/providers` → **Invite provider** (writers only). The modal follows canvas board 1: first name, last name, email, group, plus optional NPI and start date.
2. **The server saves, then sends.** `POST /api/provider-invites` first checks the email env vars and `APP_BASE_URL` (it returns 500 before writing anything). Then it calls the RPC `create_provider_intake_invite`, which creates the provider (`status = 'onboarding'`), its primary group assignment, the invite and the audit rows in one transaction. Only after that does it send the invitation email.
3. **The provider opens the email** (`provider_invitation` template), taps **Get started**, and lands on `/intake/$inviteToken`.
4. **Identify (board 3).** The page calls `POST /api/intake/link` with `{ t }` and shows "We'll send a 6-digit code to anita.rao@…" using the invited address. An unknown, expired or revoked link shows board 4b State B. There is no "use a different email" option in this slice. It tells her to ask her practice.
5. **Send me a code** → `POST /api/intake/code`. The response is always "Check your email" (board 4b State A).
6. **Code (board 4)** → `POST /api/intake/session`. On success the server sets the session cookie. A wrong code always gets the same message.
7. **Consent (board 5) and form (board 5a)** render with her name and email from `POST /api/intake/me` with `{ t }`, so the session reads back only under its own link. "Sign and continue" moves to the form. The form's Save and Continue are disabled in this slice. The note "Saving arrives in the next build" shows only while the flag is on, and the flag is on only on staging.

## 4. Data (one additive migration)

Three tables in `public`, following the `provider_ssn_intake_links` precedent: RLS enabled with no policies, `REVOKE ALL FROM anon, authenticated`, `GRANT` only to `service_role`. They are reached only through the RPCs in §5.

```sql
public.provider_intake_invites (
  id uuid pk, org_id uuid not null → organizations, provider_id uuid not null → providers,
  email text not null,             -- lowercased
  token_hash text not null unique, -- sha256 hex of the link token
  created_by uuid not null,        -- no FK, matching provider_ssn_intake_links.created_by
  created_at timestamptz default now(),
  expires_at timestamptz not null, -- +30 days
  revoked_at timestamptz           -- set when a resend replaces it
)
create unique index ... on provider_intake_invites (provider_id) where revoked_at is null;

public.provider_intake_codes (
  id uuid pk, invite_id uuid not null → invites,
  code_hash text not null,         -- sha256 of token_hash:code. Brute-forcing 10^6 offline is
                                   -- trivial; the hash only keeps codes out of casual reads,
                                   -- and the 10-minute expiry is the real control
  created_at timestamptz default now(),
  expires_at timestamptz not null, -- +10 minutes
  attempts int not null default 0, -- max 5
  consumed_at timestamptz
)

public.provider_intake_sessions (
  id uuid pk, invite_id uuid not null → invites,
  token_hash text not null unique,
  created_at timestamptz default now(),
  expires_at timestamptz not null, -- +2 hours, fixed
  revoked_at timestamptz
)
```

**Tokens.**

- The link and session tokens are 32 random bytes, base64url. Codes are 6 digits from `crypto.randomInt`.
- All three are generated in Node. Only their hashes cross into SQL.

**Audit.** `audit_log_action_type_check` allows only CREATE, UPDATE, STATUS_CHANGE, TOUCH_LOGGED, TERMINATION, READ and DELETE (`20260712150200`). So milestones are written as typed entity rows, not as new action types:

| Milestone | Audit row                                                   |
| --------- | ----------------------------------------------------------- |
| Invited   | `CREATE` · `provider_intake_invite`                         |
| Resent    | `UPDATE` (the revoke) + `CREATE` · `provider_intake_invite` |
| Signed in | `CREATE` · `provider_intake_session`                        |

- Stages derive from `(entity_type, action_type)` pairs, never from `description` text.
- The `entity_id` is the row id, never a token. Codes, tokens and emails never appear in audit rows.

**Version.** `20260903210000` is already used twice in `supabase/migrations`, so the new file takes a fresh version after `20261017120000`.

## 5. RPCs and routes

**RPCs.** All are `SECURITY DEFINER`, `SET search_path = public`, with `EXECUTE` granted only to `service_role`.

- Each takes the actor and the org **explicitly**. `auth.uid()` and `user_role()` don't work under the service key (CLAUDE.md non-negotiable 6), so authorization happens in the route.
- Each writes its own audit rows. The route must not also call `writeAudit`, the same rule as `commit_import_run`.

| RPC                                                                                                            | Does, atomically                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_provider_intake_invite(p_org_id, p_actor_id, p_actor_name, p_input jsonb, p_token_hash, p_expires_at)` | Checks the group belongs to `p_org_id`, then takes transaction advisory locks on (org, email) and, when an NPI is given, (org, group, NPI), so two simultaneous invites can't both pass the duplicate check. **Duplicates:** if a provider in the org already has this email (lowercased), or this NPI in this group, it returns `{ result: "duplicate", provider_id }` and writes nothing. Otherwise it inserts the provider, the primary group assignment and the invite, plus audit rows, and returns `{ result: "created", provider_id, invite_id, practice_name }`                                                                                                                                                                                                                                                                                                                   |
| `resend_provider_intake_invite(p_org_id, p_actor_id, p_actor_name, p_provider_id, p_token_hash, p_expires_at)` | Takes a transaction advisory lock on the provider id first, so a double submit answers `cooldown` instead of racing the one-open-invite index, then locks the provider's unrevoked invite (`FOR UPDATE`). An **expired** invite can be resent: "live" means `revoked_at is null`. Within 10 minutes of the last send it returns `cooldown`. Otherwise it revokes the old invite, inserts the new one and writes audit rows in one statement block. The new invite goes to the provider record's **current** email (the old invite's address only when the record has none), so a mistyped address is fixed by correcting the record and resending. A provider in the org with an email but **no open invite** (added by hand or by import) gets a first invite, with no cooldown, so a duplicate is never a dead end. `not_found` only when the provider isn't in the org or has no email |
| `read_intake_link(p_token_hash)`                                                                               | A live invite → `{ practice_name, email }`; anything else → null                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `issue_intake_code(p_token_hash, p_code_hash)`                                                                 | When the invite is unrevoked and unexpired and under the limits (3 codes per 10 minutes, 10 per 24 hours), it consumes any unused earlier codes, inserts the new one, and returns `{ send: true, email, practice_name, first_name }`. Otherwise it returns `{ send: false }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `verify_intake_code(p_token_hash, p_code_hash, p_session_hash, p_session_expires_at)`                          | Locks the live invite and then the newest unconsumed, unexpired code (`FOR UPDATE`), so a concurrent resend can't revoke the invite between the check and the new session. On a match with `attempts < 5`, it consumes the code, inserts the session, writes the audit row and returns `ok`. Otherwise it increments `attempts` and returns `invalid`. The lock makes the cap exact under parallel requests                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `read_intake_session(p_session_hash, p_token_hash)`                                                            | When the session is unrevoked and unexpired, **its invite is unrevoked, and that invite is the link being opened**, returns `{ practice_name, first_name, last_name, email }`. A resend therefore ends any open session on the old invite, and a shared browser can't show one provider's session under another's link                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `revoke_intake_session(p_session_hash)`                                                                        | Sign-out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Routes:**

| Route                                           | Auth                        | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/provider-invites`                    | `authenticate` + `isWriter` | Checks the email env and `APP_BASE_URL` first (500 if either is missing). Validates the body (names required, email valid, 4 KB bound). Calls `create_provider_intake_invite`. A duplicate returns `200 { outcome: "already_exists", providerId }` (the envelope's `fail()` carries no data), and the dialog offers Resend. Otherwise it sends the email and returns `201 { outcome: "created", providerId, delivery }`, where `delivery` is `"sent"`, `"sandbox"` (SendGrid accepted it in sandbox mode, so nothing was delivered) or `"failed"` (the invite is saved; the send is never an error) |
| `POST /api/provider-invites/:providerId/resend` | `authenticate` + `isWriter` | Env check, then the RPC. Not-found → 404, cooldown → 429, success → send and `200 { delivery, email }`, where `email` is the address the RPC chose (the record's current email), which may differ from what staff typed when the duplicate matched on NPI                                                                                                                                                                                                                                                                                                                                           |
| `POST /api/intake/link`                         | none                        | Body `{ t }`. A live token returns `{ practiceName, email }`. Unknown, expired and revoked tokens all return the same `404 { error: "invalid_link" }`. The token goes in a POST body so it stays out of request logs                                                                                                                                                                                                                                                                                                                                                                                |
| `POST /api/intake/code`                         | none                        | Body `{ t }`. Returns `200 { sent: true }` for every link state. It sends the code email only when the RPC says `send`, and a send failure is still reported as 200. The one exception is a missing email env: that is a server fault, so it is a 500 before any code is issued                                                                                                                                                                                                                                                                                                                     |
| `POST /api/intake/session`                      | none                        | Body `{ t, code }`. Calls `verify_intake_code`. On `ok`: `Set-Cookie`. On anything else: `400 { error: "code_invalid" }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `POST /api/intake/me`                           | session cookie              | Body `{ t }`. Calls `read_intake_session` with the session hash **and** the link hash. Returns 401 when the cookie or `t` is missing, the session is dead, or the session belongs to another link                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /api/intake/signout`                      | session cookie              | Revokes the session and clears the cookie                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Cookie.**

- Attributes: `mp_intake=<token>; HttpOnly; Secure; SameSite=Strict; Path=/api/intake; Max-Age=7200`.
- `Secure` is dropped only when `import.meta.env.DEV` is set (Safari won't keep it on `http://localhost`).
- `SameSite=Strict` works here, which the reviewers checked. The email click is a navigation to `/intake/…`, a path the cookie doesn't cover, and the cookie is only sent on same-origin `fetch` calls from that page.
- The server mints a new token on every successful sign-in, so session fixation isn't possible.

**Request handling:**

- Anonymous routes are POST-only and reject any `Content-Type` other than `application/json` with 415. That, plus `SameSite=Strict`, is the CSRF defence.
- Bodies (intake and invite) are read with `readBoundedJsonBody(request, 4096)`.
- The invite routes match in `routeApiRequest` behind the normal guard. `/api/intake/*` is dispatched in `handleApiRequest` before `resolveOperationContext`, so no bearer is ever looked for there (`src/server/api.intake.test.ts`).

**Responses:**

- Everything uses the `ok()`/`fail()` envelope.
- Intake responses set `Cache-Control: no-store`.
- Nothing logs a body, email, code or token.
- The intake page sets `Referrer-Policy: no-referrer`.

**No kill switch.** Pre-launch the only users are internal (Oct 26), so the routes and the Invite button are live wherever the code runs. Without the migration or the email env they return 500.

**Not in this slice: per-IP limiting.** `check_rpc_throttle` keys on `inet_client_addr()`, which is the pooler's address, not the caller's (`20260710130000:57`). The link token has 256 bits, so nobody can guess invites, and the per-invite limits bound what one leaked link can do. Per-IP limiting from Vercel's `x-forwarded-for` comes with the practice-key route (reminders), where an email can be typed without a link.

## 6. Email templates (closed registry)

| Key                   | Data                                | Content                                                                                                                                                                      |
| --------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider_invitation` | `{ practiceName, firstName, link }` | Board 2 copy: the have-ready list, one **Get started** button, and "We'll send a 6-digit code…". The reassurance line is the canvas placeholder, marked as such              |
| `intake_code`         | `{ practiceName, code }`            | Subject "Your sign-in code for <practice>" (the code is never in the subject, so lock-screen previews don't show it). Body: the code and "It expires in 10 minutes." No link |

**Sender details:**

- **From:** `<Practice> via Minted Panel`. The practice name is `organizations.name`.
- **Reply-to:** the inviting staff user's email. It falls back to `SENDGRID_FROM_EMAIL` when `ctx.email` is null (`guard.ts:39`). For the code email, which has no inviter, it is `SENDGRID_FROM_EMAIL`.
- **Link:** built from `APP_BASE_URL` (a new server env var) + `/intake/<token>`. The value must be a bare `https` origin (no path, query or fragment; `http://localhost` only in dev). Anything else counts as missing, so a typo is a 500 on the invite routes, not a bad link in a provider's inbox.

**Delivery.** Sends deliver unless `SENDGRID_SANDBOX=true` (`docs/sendgrid-email.md`).

## 7. Frontend

- **Staff.** `InviteProviderDialog` on `/providers`, mounted only while open (the modal convention). The chain is hooks `useCreateProviderInvite` / `useResendProviderInvite` (`src/hooks/useProviderInvites.ts`) → service `src/services/providerInvites.ts` → `authedApiFetch('/api/provider-invites…')` with the user's JWT and `x-org-id`.
  - On `delivery: "failed"`, a toast says the invite was saved and to resend in 10 minutes; on `"sandbox"`, that nothing was delivered.
  - `outcome: "already_exists"` shows the existing-provider note with a Resend button; the success toast names the address the resend went to (the record's email, not the typed one). Only active groups are offered.
- **Provider.** The route is `src/routes/intake.$token.tsx`, added to the chromeless public list in `__root.tsx`.
  - The steps (3 → 4 → 4b → 5 → 5a) live in component state, on one route.
  - Service `src/services/intake.ts` calls `/api/intake/*` with `credentials: "same-origin"`. It skips `requireActiveOrg()`, making it the third service that does.
- **Docs updated in the same change:**
  - CLAUDE.md: the "No frontend hook calls `/api`" rule gains a third sanctioned exception, and the route table gains the new routes.
  - AGENTS.md: the sanctioned browser API surfaces list.
  - `docs/data-model/table-register.md`: rows for the three tables.
- **Components.** The real builds of the preview components (`r1-ui-spec.md` §4, §7): provider shell, identify, code entry, check-your-email, invalid link, consent, and the form (read-only in this slice).

## 8. Security and the isolation gate

**Gate assertions** 35–35d in `scripts/verify-org-isolation.mjs` (leak modes `providerinvites` and `intakesession` in `mock-api-server.mjs`, registered in `verify-isolation-local.mjs`):

- **35. Positive control.** `POST /api/provider-invites` with an empty body returns 422, which proves the route is live. If it returns 404 (code not deployed) or the 500 "Provider invites are not configured" (no email env), 35–35c report SKIP, so they can't pass by accident.
- **35b. Cross-org group.** `POST /api/provider-invites` with another org's `groupId` (`SOUTHPARK_GROUP_ID`) returns 404 and creates nothing (`leak: true`).
- **35c. Cross-org resend.** A resend for another org's provider returns 404 (`leak: true`).
- **35d. Session scope.** Under `IS_LOCAL_MOCK_API` only, a session from org A's invite never returns org B data. Node's `fetch` keeps no cookie jar, so the gate forwards `getSetCookie()` by hand.

**Enumeration.**

- `/api/intake/code` always gives the same answer.
- `/api/intake/link` has one failure body for every bad-link case.
- `/api/intake/session` has one failure body.
- The provider never types an email (S6), so whether an address is on file never shows up in any response.

**Brute force.** Each code allows 5 attempts, enforced under a row lock. Each invite gets at most 3 codes per 10 minutes and 10 per day.

**PHI.** Responses carry names and the invited email only. No `select('*')`.

## 9. Before staging use: checks, then operator steps (I don't do the operator steps)

**Checks first:**

1. **Staging URL.** Confirm the staging URL providers will open. `staging.mintedpanel.com` is only "intended" (CLAUDE.md).
2. **Deployment Protection.** Confirm it's off for that URL, or providers hit a Vercel sign-in wall.
3. **SendGrid domain.** Confirm domain authentication for the `SENDGRID_FROM_EMAIL` domain. The Oct 25 live test returned 202, but delivery and the SPF/DKIM headers still need to be checked in the inbox.

**Operator steps:**

1. Apply the migration to **staging** (`vmznysvietfaddakkegt`) after review, then run `scripts/sql/provider-intake-smoke.sql` (one rolled-back transaction that exercises every RPC and the grants) and verify the objects exist. Never production.
2. Set these in the Vercel **staging** project:
   - `SENDGRID_API_KEY`
   - `SENDGRID_FROM_EMAIL`
   - `APP_BASE_URL`

   Set them per project in the Vercel UI, not in `vercel.json`, whose env block is shared by both projects.

3. Production: no migration yet, so the Invite button there returns 500 until it is applied.

## 10. Build order and verification

1. **Migration.** Tables and RPCs, plus `scripts/sql/provider-intake-smoke.sql` for the first apply. `types.ts` gets hand-added RPC signatures; no regen (see the unapplied-migration trap in CLAUDE.md).
2. **Pure server helpers, tests first:** token, code and session generation and hashing; cookie build and parse; the content-type and body guard; mapping RPC results to uniform responses.
3. **Routes, with route tests** against a mocked db, like `src/server/providerRoutes.test.ts`. Cases: happy path, missing env (no write), wrong org, duplicate, five wrong codes, expired code, revoked link, cooldown, send failure, and resend ending the old session.
4. **The gate:** assertions A–D, the mock server and the leak mode. `node scripts/verify-isolation-local.mjs` must be green.
5. **Templates,** plus a CLI `--template` option. Send both in sandbox.
6. **Frontend:** the invite dialog, then the intake route and its steps. `e2e/provider-intake.spec.ts` on the mock harness covers identify → code → consent → form, the invalid link, and a failed details read after sign-in (Try again, not a dead spinner).
7. **Static stack:** `npm run lint && npx tsc --noEmit && npm run test && npx prettier --check .`
8. **On staging,** after §9: invite your own address, receive the email, sign in with the code, and land on consent and the form.

## 11. Open questions

| #    | Question                                                                                                                                                                                                                             | Recommendation                                                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q-S1 | Reply-to on provider emails in this slice                                                                                                                                                                                            | The inviting staff user, falling back to `SENDGRID_FROM_EMAIL` (§6)                                                                                                                                                                                                                                    |
| Q-S2 | Who may invite: admin and specialist, or admin only?                                                                                                                                                                                 | `isWriter` (both), matching every other provider write                                                                                                                                                                                                                                                 |
| Q-S3 | Duplicates: the same email in the org, or the same NPI in the same group, returns the existing provider and offers Resend. An NPI in _another_ group of the org should join the existing record (spec rule 3); that join is deferred | As written                                                                                                                                                                                                                                                                                             |
| Q-S4 | Invites last 30 days; sessions last 2 hours, fixed                                                                                                                                                                                   | As written                                                                                                                                                                                                                                                                                             |
| Q-S5 | The link is `/intake/<token>`, not the spec's `/intake/$practiceKey` (R1.15). The practice key is needed only to get back in without a link (reminders, R2)                                                                          | Use the token route now. Add the practice-key route, with per-IP limits, alongside reminders                                                                                                                                                                                                           |
| Q-S6 | No "use a different email" in this slice (S6). The code always goes to the invited address                                                                                                                                           | As written. A wrong address is fixed by correcting the email on the provider record and pressing Resend: the new invite goes to the record's current email. Re-inviting with the corrected address is not a fix (with an NPI it returns the existing provider; without one it creates a second record) |
