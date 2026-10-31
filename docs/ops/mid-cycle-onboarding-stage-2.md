# Mid-Cycle & Continuous Provider Onboarding — Stage 2

> **Amended Oct 19, 2026.** The Oct 18 to 19 design review changed parts of this doc. Where they conflict, the provider onboarding engineering handoff wins. It's in the Obsidian vault at `20 Projects/Minted Panel/Minted Panel - Provider Onboarding Engineering Handoff.md`. Changes that touch this doc:
> - §2.2 thresholds: reminders go every 48 hours without progress, worded by stage ("Start your application" or "Complete your application"), until she submits. After the third unanswered reminder the practice gets one email. There are no provider-stage stall thresholds in hours.
> - No screen shows provider hours in stage, past-target pills or speed-against-target. Provider-side times live only on the report. Minted's hand-off keeps its 8-business-hour target.
> - The Onboarding Pipeline report becomes the Provider Onboarding report, with a Needs a human section. The coordinator works the report, not the next-best-action queue.
> - Rows show "Invited", not "Invited by NAME".
> - The hand-off checklist splits into automatic checks (pre-ticked) and human checks, followed by one Admit & assign click.

**Status:** vision / planning only. No code. Builds on the approved, revised
Stage 1 ([`mid-cycle-onboarding-stage-1.md`](./mid-cycle-onboarding-stage-1.md)).
All thresholds are in business hours against the Stage 1 §1.5 targets.
**Date:** 2026-10-16
**Scope:** the org-facing "pizza tracker" (2.1) and the bottleneck / chaser loop
(2.2). Stage 3 (sensitive capture, buy vs build) is in
[`mid-cycle-onboarding-stage-3.md`](./mid-cycle-onboarding-stage-3.md).

Carried in from Stage 1 (not re-argued here):

- Ingestion lands on the existing provider row and the existing
  `status` / `verification_state` pair. No new status column.
- The gateway (Option B) is the provider's resume mechanism; a code to the bound
  inbox is the key, the link is only the door.
- "Invitation sent," "code verified," "submitted," and "admitted" are events,
  written as `audit_log` rows (and provider `notes` where a human should read
  them), never as flags.
- A transactional email path with a DMARC-aligned Minted sender and the org's
  name in the display name is a prerequisite (Stage 1 §5.1).
- The client (practice manager / owner) holds one password-less login per
  practice in the E6.12 restricted client context, with exactly one write:
  "Invite a provider" (Stage 1 §1.7). The tracker is what that login shows.
- Two workflows with different owners (Stage 1 §1.8): A creates the record
  (practice or its EHR), B completes it to the Minimum Data Set (provider,
  practice, Minted by field). The MDS itself is a draft awaiting PM definition
  (Stage 1 §1.10); the tracker depends only on its tiers and owners.
- Targets (Stage 1 §1.5): first verified session under 4 business hours,
  submission under 24 hours, admission under 8 business hours, ≥ 85% admitted
  within 7 days, human re-issue rate under 10%.

---

## 2.0 The zero-overbuild rule for this stage

The tracker is a **derivation**, exactly like `caseRollups.ts`,
`enrollmentReadiness.ts`, and `providerGaps.ts`: a pure function in `src/lib/`
that takes rows the app already loads plus a passed-in `today`, and returns a
stage per provider and counters per org. Nothing in this stage stores a stage.
If a stage cannot be derived from existing data plus the event rows Stage 1
already commits to, the stage is wrong, not the data.

The two surfaces that render it already exist as patterns:

- **Per-provider:** the `/providers` work view already renders sections and gap
  pills per row (`providers.index.tsx`). The tracker adds one pill and one
  grouping.
- **Aggregate / executive:** `src/lib/reports.ts` has an `intake` report group
  with no entries yet, and "adding a report is one registry entry + one route."
  The read-only `/share/$token` portfolio already carries exec-facing counters
  to people without logins.

---

## 2.1 The "pizza tracker": mapping existing states to five stages

### The five stages

| # | Stage (org-facing label) | Derived from (all existing) | Accountable party | Exit event |
| --- | --- | --- | --- | --- |
| 1 | **Invited** | Provider row exists with `status = 'onboarding'`; an active intake link for the provider (Stage 1's `provider_intake_links`, the E4.4 link shape); no `code_verified` audit row yet. | Provider (to open) / coordinator (to re-send) | First verified gateway session |
| 2 | **Started** | At least one `code_verified` audit row for the provider; no `self_submitted` audit row; link still `active`. | Provider | Submission |
| 3 | **Submitted** | A `self_submitted` audit row exists (the anon submit RPC writes it); link `used`. Row may still be `pending_verification` (self-registered via the org URL) or already `verified` (admin-invited). | Coordinator (to review and admit) | Admission |
| 4 | **Admitted** (handed to credentialing) | `verification_state = 'verified'` **and** ≥1 `provider_facility_assignments` row **and** a primary `provider_group_assignments` row. This is precisely the condition under which `listProviderReadinessFacts` stops fencing the provider out and generation can see them. | Coordinator (to generate cases) | First `credential_cases` row |
| 5 | **In credentialing** | ≥1 `credential_cases` row for the provider. Per-case progress belongs to the Cases Matrix and `caseRollups`; the tracker stops here and links out. | Coordinator / payer (already tracked by case status) | Out of scope for this tracker |

### The two workflows under the five stages (Stage 1 §1.8)

| Stage | Workflow | Owner of the step |
| --- | --- | --- |
| Row created (any door: client invite, coordinator, join link, CSV, EHR) | **A — Create the record** | The practice, or its system of record. Shown on the row as the source ("Invited by Dana S.", "from EHR", "from CSV"). |
| 1 Invited · 2 Started · 3 Submitted | **B — Complete to the MDS**, provider-owned fields | The provider |
| 3 Submitted → 4 Admitted | **B**, Minted-owned steps: verify, dedupe, assign | Minted |
| Practice-owned MDS facts (facility assignment, group documents) | **B**, practice-owned | The practice, collected once per group in the onboarding wizard; a missing one surfaces in the owner view's "Needs you", never as a provider nudge |
| 5 In credentialing | Out of this program | Cases Matrix |

Workflow A has no stage of its own because it completes in seconds; the
tracker records only that it happened and from which door. Everything the
tracker measures is Workflow B, and every "waiting on" sentence names the
owner the MDS assigns to the missing field.

Three side-states that are not stages but must render honestly:

| Side-state | Derived from | Rendering |
| --- | --- | --- |
| **Expired link** | Link `expired` (lazy-expired on validate) and no submission. | Stays in its stage (1 or 2) with an "expired — resend" affordance. Never a sixth stage. |
| **Needs attention** | Submitted row flagged as a probable duplicate (NPI matched a different email at the gateway — Stage 1 §4) or with `missing_npi` from `deriveProviderGaps`. | A pill on stage 3, pointing at the merge/admit action. |
| **Stalled** | Days in the current stage beyond that stage's threshold (§2.2). | A red count on the stage header, and a pill on the row. |

**Why these five.** Each boundary is an event one party controls, so each stage
has exactly one accountable party (R2's second failure mode). Each is a fact
the DB already holds or an audit row Stage 1 already commits to writing. And
the fourth boundary is not invented: it is the existing readiness fence,
restated as a stage.

### Why the first stage is "Invited," not "Hired"

A row created by quick-invite, CSV re-import, or the org URL is already at
stage 1 or 3. There is no stage before an invitation because the system has no
knowledge before one. The client's own "Invite a provider" action (Stage 1
T2) is how a hire the system does not know about becomes an invitation, in
minutes; it is a trigger, not a stage.

### Row level (coordinator and admin)

On `/providers`, **nothing is replaced**. The existing page keeps its header,
"Export roster", the search / group / license-state / "Has gaps" toolbar, the
CSV upload card, the eight-column A→Z `RowTable`, inline `Pending verification`
and `Reference` pills, and the Reference section. Onboarding is woven into
existing slots (revised 2026-10-17 after mock review):

- one more toolbar toggle, **"Onboarding · n"**, styled like "Has gaps",
  filtering to `status = 'onboarding'`; the A→Z rule stands (filters never
  change the sort), so "longest stalled first" lives on the report, not here;
- an onboarding **stage pill in the inline-pill slot** beside the name
  ("Invited · 6h · past target"), toned by accountable party, deep-linking to
  the record's Onboarding section exactly as gap pills deep-link to sections;
- "New Provider" becomes a two-item menu: **Add manually** (the form, as
  today) and **Invite by email**;
- the CSV card's helper notes that net-new rows can be invited at commit (T4).

The coordinator's **actions live on the provider record**, not the roster: a
new `RecordSectionCard` "Onboarding", shown ahead of Identity while
`status = 'onboarding'`, carrying the five-step indicator, "waiting on",
invited by/when/to, reminders, source, a "to admit" checklist of the draft
Tier 1 items, and the buttons Resend invitation / Mark contacted / Admit &
assign (disabled until the checklist passes). Activity reuses the provider
`notes` surface. After admission the card collapses to a one-line history.

The prior description of each row (kept for the pill and record card):

```
Dr. Anita Rao, PT   ● Started · 31h   Invited by Dana S. (client) · nudge 1 sent Oct 15 8:02 · next Oct 16 8:00   [Resend] [Mark contacted]
```

- The stage pill uses `StatusPill` tones (ours / waiting-provider / complete),
  never a hand-rolled chip.
- "Time in stage" is business hours from the stage's entry event timestamp to
  the passed-in `now`, using the same date-only discipline as every other lib
  (a business-hours helper with a fixed calendar, no clock read inside the
  lib). It renders as hours under 48, days after.
- "Invited by" names the actor and marks client-initiated invitations, so a
  coordinator knows the practice already expects this hire.
- Existing gap pills (`deriveProviderGaps`) continue to render beside the stage
  pill for stages 3–5, so "Submitted but missing CAQH" is visible without a
  second screen.
- Row actions are the existing ones: open record, admit (flip the fence),
  assign group/facility. Plus two chaser actions from §2.2: **Resend** and
  **Mark contacted**.

### The client's view of the same rows

The E6.12 client context renders the **same derivation**, filtered to the
client's granted groups, with the same five stage pills and time-in-stage.
What differs is the action set:

| Action | Coordinator (panel) | Client (restricted context) |
| --- | --- | --- |
| Invite a provider | yes | **yes** (the one write, Stage 1 §1.7) |
| Resend invitation | yes | yes — it is the same write (revoke-then-issue on the invitation the client owns) |
| Mark contacted | yes | yes — a provider `notes` row; it resets the nudge clock and is the client's way to say "I spoke to her, she'll do it tonight" |
| Admit, assign facility, merge duplicate, open record | yes | no — read-only pills; the client sees "Submitted · awaiting Minted" and the time since |
| Open the provider record | yes | no — the client never sees the provider's PHI, only name, stage, and time |

Admission and everything after it stays with Minted. The client gets the
visibility that answers "did they submit, how many in queue, how many handed
off," and the two levers only they hold: the invitation and the phone call.

### Aggregate level (executive)

One report, registry entry under the `intake` group, titled **Onboarding
Pipeline**:

```
 Invited   Started   Submitted   Admitted   In credentialing
    3         2          1           4             11
   (1 stalled)        (1 needs attention)
```

- Five counters, each a link to the `/providers` Onboarding grouping filtered
  to that stage.
- Filters: group, facility (both existing dimensions).
- The §1.5 metrics as one line each, last 90 days, each against its target:
  "First touch 2.6h (target 4h) · Submitted 19h (target 24h) · Admitted 6.1h
  (target 8h) · Completed in 7 days 91% (target 85%) · Re-issued 4% (target
  10%)." Computed from the audit rows. No chart.
- Exposed in the client context (the client's home screen is this report
  scoped to their groups) and on the read-only `/share/$token` portfolio as a
  single row of the five counters, so an owner with no login at all sees the
  same truth the coordinator sees.

### What the executive does **not** get

- No per-provider timeline UI. The audit log already exists for that.
- No SLA configuration. Thresholds are code-owned (§2.2), like
  `documents.ts` expiry windows.
- No charts beyond the counter row and the one median. Owners asked for "did
  they submit, how many in queue, how many handed off" and the counters answer
  exactly that.

### Where the derivation lives

`src/lib/providerOnboardingStage.ts` (pure, tested, `today` passed in):

- `deriveOnboardingStage(inputs, now) → { stage, enteredAt, businessHoursInStage, stalled, attention[] }`
- `rollupOnboardingPipeline(rows, now) → { counts per stage, stalled per stage, metrics vs targets }`
- `dueNudges(rows, now)` and `dueEscalations(rows, now)` (§2.2) — the scheduler
  calls these and nothing else.

Inputs are rows the app already loads (providers, facility and group
assignments, cases) plus the provider's intake-link row and its onboarding
audit events, fetched once per org by a hook keyed under `queryKeys.providers`.

---

## 2.2 The chaser loop: nudges and escalation without a CRM

### Design stance

The loop has one job: move a provider from a stalled stage to the next one with
the fewest messages, and when messages stop working, hand the problem to the
one human who can unstick it. It is not a sequence builder, not a template
designer, and not an inbox. Its state is the audit log; its logic is the same
pure lib the tracker uses; its only moving part is one scheduled job.

### Thresholds (code-owned, per stage, in business hours)

> Per the PM rule in Stage 1 §1.5 (2026-10-19): provider-side thresholds
> below are **reminder triggers**, not targets. Only the Minted-owned rows
> (Submitted, Ready) carry a target.


Each threshold is the §1.5 target for that boundary. A row is "stalled" the
moment it misses its target, so the tracker's stalled count is literally "rows
currently missing the metric," and the chaser fires on the same condition.

| Stage | "Stalled" after (business hours in stage) | Who is nudged | Escalation |
| --- | --- | --- | --- |
| 1 Invited | **4h** with no verified session (the first-touch target) | Provider, by email | Client admin sees the stalled pill at 4h; gets an email after nudge 3 is unanswered (≈ 3 business days) |
| 2 Started | **8h** with no submission (keeps the 24h submission target reachable) | Provider, by email | Same ladder |
| 3 Submitted | **4h** with no admission (half the 8h admission target) | Coordinator, in-queue (no email) | Minted ops digest if still unadmitted at 8h |
| 4 Admitted | **1 business day** with no case generated | Coordinator, in-queue | Minted ops digest |

Business hours are 8am–6pm in the org's time zone, Monday to Friday, with the
org's time zone an additive column defaulting to the first facility's state.
These are the panel's starting values; M1 (Stage 1 research) calibrates them,
and they live in one constant block, like `documents.ts` expiry windows.

### The provider nudge ladder (max three, then stop)

| Nudge | When | Content | Tone |
| --- | --- | --- | --- |
| 1 | Stalled threshold reached, delivered at the **next business-hour boundary** (an invitation sent at 2:11 pm that is untouched at 6:11 pm nudges at 8:00 am next morning, not at 6:11 pm) | "Dana at Shelby Sports Rehab still needs your credentialing details. It takes about 10 minutes and you can pick up where you left off." One button: **Continue** (the gateway). | Warm, from the inviter's name. |
| 2 | +1 business day after nudge 1 | Same, plus the two escape hatches (below). | Same. |
| 3 | +2 business days after nudge 2 | "This is the last automatic reminder. If you need help, reply here or tell Dana." | Same, and explicitly final. |

After nudge 3 the loop **stops emailing the provider**. More email does not
move a clinician who has ignored three; it only trains them to ignore the
sender. The problem is handed to the org admin, who has a phone.

Every nudge carries two provider-side escape hatches, each a single link to a
tiny confirm page (no login):

- **"I need help"** → writes a provider `notes` row ("Provider requested help,
  Oct 14") and flags the row "needs attention." The coordinator sees it on the
  tracker; nudges pause until a coordinator marks contacted.
- **"I was told I don't need to do this"** → writes the same kind of note and
  pauses nudges; the admin decides (terminate the row, or re-invite with
  context).

Quiet rules, enforced by the lib before any send:

- Never more than one email to a provider per business day, and never
  outside business hours (a stalled row waits for 8:00 am).
- Never after a `self_submitted` event, after a pause flag, or after three
  nudges.
- Never on a provider whose link is `revoked` (the admin withdrew the
  invitation).
- Every send writes an `audit_log` row (`entity_type = 'provider'`,
  `description = 'nudge 2 sent'`). The next run reads those rows, so a crashed
  or doubled run cannot double-send: the send is idempotent on the audit row.

### Coordinator and admin side

- **Coordinator (stages 3–4):** no email. The stalled count on the `/providers`
  Onboarding grouping and the existing next-best-action queue carry it.
  `nextBestActions.ts` already ranks work by provider start date ("starts seeing
  patients Oct 20 — ranked by the provider start date"); a submitted-but-not-
  admitted provider with a start date inside 30 days is surfaced there with the
  reason "awaiting admission." No new ranking seam.
- **Client admin (escalation):** the stalled pill appears in their context at
  the 4h mark with no email — they are in the building and will see it next
  time they open the tracker. One email when a provider exhausts the nudge
  ladder ("Dr. Rao has not responded to three reminders since Tuesday — call
  her, or resend"), with **Resend** and **Mark contacted** deep links into the
  client context (session required; the link acts only after sign-in). Plus a
  **weekly digest** on Monday listing every stalled row in their groups,
  suppressed when nothing is stalled. No digest is sent for an empty pipeline.
- **Minted ops (stage 3–4 stalls):** a daily digest of submitted-not-admitted
  and admitted-not-generated rows across all orgs, because those stalls are
  Minted's own metric, not the client's.
- **Mark contacted** (coordinator or admin, in-app): writes a provider note
  ("Called Dr. Rao, will submit Thursday") and resets the nudge clock. It is
  the only manual control, and it is a note, not a status.
- **Resend**: issues a fresh invitation (revoke-then-issue, the existing link
  RPC pattern), resets the ladder to nudge 0, writes the audit row.

### The one moving part: the scheduler

A single scheduled job, **hourly during business hours**, that for each org:

1. loads the same inputs the tracker uses,
2. runs `deriveOnboardingStage` for each onboarding provider,
3. asks the lib `dueNudges(rows, today)` and `dueEscalations(rows, today)`,
4. sends each through the transactional email path,
5. writes the audit row per send.

Hosting options, in order of preference:

1. **Supabase `pg_cron` + an edge function**, the same shape as the existing
   `invite-member` edge function; runs next to the data, no new infra.
2. **GitHub Actions cron** (the `scheduled-backup.yml` pattern already exists),
   calling a guarded `/api` route with a shared secret, the same posture as the
   planned email-to-touch webhook.
3. **Vercel cron** hitting the same route.

The route or function is thin: it calls the pure lib and the mailer. All logic
is tested in the lib with a fixed `now`, exactly like `followUps.test.ts`.
Hourly is what makes hour-based thresholds honest; a daily job would turn a 4h
threshold into "sometime tomorrow." Idempotency on the audit row (above) is
what makes hourly safe.

### Email trust posture (what R4 and R1 required)

- Sender: `onboarding@mintedpanel.com` (DMARC-aligned), display name
  "Dana Shelby via Minted Panel for Shelby Sports Rehab."
- Reply-to: the inviting coordinator's real address, so "reply here" reaches a
  human. Replies are not parsed; the email-to-touch webhook stays a separate,
  case-scoped project.
- Every email states what the link will and will not ask for (never SSN, never
  passwords), the same sentence the gateway shows. Consistency across the email
  and the landing page is the anti-phishing cue.
- No tracking pixels. Opens are not measured; verified sessions are.

### What this stage deliberately does not build

- No template editor. Three templates, code-owned, with the org and inviter
  names interpolated.
- No SMS. Revisit only if M1 shows clinicians do not read work email, and then
  via the same lib with a second channel.
- No in-app notification center. The tracker and the next-best-action queue are
  the inbox.
- No per-org threshold settings. One set of defaults, calibrated by research,
  changed in code.
- No "sequence" or "campaign" objects. The ladder is a function of the audit
  rows and `today`.

---

## 2.4 Metric definitions: every item on the Onboarding report, and how it is measured

Added 2026-10-17 at PM request: each element on the report (and the owner
view) must be computable from rows we hold. Nothing below depends on an email
vendor; delivery and open events are deliberately **not** metrics.

### Event sources (all existing or committed by Stage 1)

| Event | Where it is recorded | Timestamp used |
| --- | --- | --- |
| `invited` | `audit_log` CREATE on the intake link (Stage 1 §1.6), `entity_type = 'provider'`, description carries the source | `audit_log.ts` |
| `code_verified` | `audit_log` row written by `verify_intake_code` | `audit_log.ts` |
| `submitted` | `audit_log` row written by `submit_intake` | `audit_log.ts` |
| `admitted` | **Must be explicit.** Today the verification flip and the facility assignment are two separate writes with no single "admitted" event. Build rule: the Admit & assign action writes one `audit_log` row `onboarding.admitted` after both succeed; for rows admitted outside that action, `admitted_at = max(verification_state flip ts, first facility assignment ts)` from their own audit rows. | `audit_log.ts` |
| `case_generated` | First `credential_cases` row for the provider | `credential_cases.created_at` |
| `nudge_sent` | `audit_log` row written by the scheduler per send (idempotency key) | `audit_log.ts` |
| `help_requested`, `told_not_needed`, `contacted` | Provider `notes` rows with a fixed prefix, written by the escape hatches and the Mark-contacted action | `notes.created_at` |
| Start date, status, assignments, cases | Existing columns and tables | — |

All durations are **business hours** (8am–6pm, Mon–Fri, org time zone), via
the one pure helper in `providerOnboardingStage.ts`. Medians are used, never
means. "Now" and the period window are passed in; the lib never reads a clock.

### Report items

| Item on screen | Type | Formula | Shown when | If it cannot be tracked |
| --- | --- | --- | --- | --- |
| **In onboarding now** · 9 | Stock | `count(providers where status = 'onboarding' and not reference_only)` | Always | Always trackable (a column). |
| …"23 invited in the last 90 days" | Flow | `count(invited events in window)` | Always | Trackable. The earlier "+3 vs prior 90 days" on a stock number was **removed**: a point-in-time stock has no honest prior-period value without snapshots. |
| **Past target now** · 2 | Stock | rows whose current stage has been held longer than that stage's threshold (§2.2), split by accountable party from the stage | Always | Trackable from stage entry events. The "+1 vs prior" delta was **removed** for the same reason. |
| **Hours to admitted · median** · 19h, −12h, target 24 | Flow | median over providers with `admitted` in window of `bh(invited → admitted)`; delta = same over the previous window | ≥ 5 admitted in window, else "not enough data" | Needs the explicit `admitted` event above; until it exists, the fallback `max(flip, assignment)` is used and labelled "approx." |
| **Admitted within 7 days** · 91%, target 85% | Cohort | cohort = providers `invited` in `[window start, now − 7 days]`; value = share with `admitted ≤ invited + 7 calendar days`; shown as "21 of 23" | Cohort ≥ 5 | Trackable. The cohort excludes the last 7 days so no one is counted before they have had the chance. |
| **Hours to admitted, by week** (12 columns) | Flow | per ISO week of `admitted`: median `bh(invited → admitted)`; target line = constant | Weeks with ≥ 3 admissions draw a bar; others draw a hollow marker | Trackable. |
| **Where they are now** (stacked bar, counts, provider/Minted split) | Stock | stage per row from events (§2.1); clinician = Invited/Started; Minted = Submitted/Admitted | Always | Trackable. |
| **Speed vs target** bullets | Flow | first touch = median `bh(invited → code_verified)`; submitted = median `bh(invited → submitted)`; admitted = median `bh(submitted → admitted)`; each over events in window | ≥ 5 events each | Trackable. "First touch" is defined by the code, **not** by an email open; we never measure opens. |
| **Needs a human** list | Stock | rows that are past target, or carry `help_requested` / `told_not_needed` with no later `contacted`, or are flagged possible duplicate (NPI match on another row) | Always | Trackable. |
| Group / facility filters | Filter | join through `provider_group_assignments` and `provider_facility_assignments` | Always | Trackable; a provider with no assignment appears only under "All". |
| Period selector | Filter | window applied to flow and cohort metrics only; stock metrics ignore it | Always | — |
| Share | Action | existing `report_shares` read-only token | Always | — |

### Owner view (CEO screen) items

| Item | Formula |
| --- | --- |
| "5 new hires can't bill yet" | `count(status = 'onboarding')` for the client's granted groups |
| "1 waiting on you · 2 with the clinician · 2 with Minted" | accountable party per row: you = `help_requested` / `told_not_needed` / ladder exhausted without `contacted`; clinician = Invited/Started; Minted = Submitted/Admitted |
| Per-row tracker and "waiting on … · n hrs" | stage from events; hours = `bh(stage entry → now)`; "past target" = beyond §2.2 threshold |
| "Invitation to submitted 19 hrs · target 24", "Submitted to handed to Minted 6 hrs · target 8", "10 of 11 within a week" | the same three flow metrics as the report, scoped to the client's groups, with the sample size shown and the section hidden below 5 hires in the window |
| "9 earlier hires are in credentialing" | `count(providers with ≥ 1 non-terminal case)` in the client's groups |

### Not measured, on purpose

- Email delivered, opened, or clicked: no vendor chosen, no tracking pixels,
  and the design does not need them. "Not started" means no verified session.
- Time spent on the form: we hold no per-field timing.
- Dollar impact: no revenue data on the row.
- Reminder effectiveness beyond counts: `nudge_sent` counts are shown on the
  record only.

---

## 2.3 Decisions carried into Stage 3

- Sensitive capture (SSN, CAQH, PECOS) is **not** on the Stage 2 tracker as a
  stage. It is a gap pill on stages 3–5 ("SSN not on file," "CAQH credentials
  not on file"), derived the way `missing_caqh` already is, so a provider is
  never blocked from "Admitted" by it, and the coordinator sees it where they
  already look.
- A provider's own nudge for a missing sensitive item uses the same ladder and
  the same gateway; Stage 3 decides what that gateway loads.
