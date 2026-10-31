# Mid-Cycle & Continuous Provider Onboarding — Stage 1

> **Amended Oct 19, 2026.** The Oct 18 to 19 design review changed parts of this doc. Where they conflict, the provider onboarding engineering handoff wins. It's in the Obsidian vault at `20 Projects/Minted Panel/Minted Panel - Provider Onboarding Engineering Handoff.md`. Changes that touch this doc:
> - T1 (coordinator quick-invite) and T3 (org self-service URL, `organizations.slug`) are removed. Single hires come only through the practice's Invite (T2), and rosters (T4) are uploaded by Minted from the practice's spreadsheet.
> - The client login becomes many practice sign-ins with owner, coordinator and billing roles and per-report access (§1.7).
> - §1.5 targets: only Minted's hand-off (under 8 business hours) is a target. Provider-side times are measured and reported, never shown in the product.
> - §1.4 and §5.6, "never ask at the gateway": reversed. The full profile, including SSN and CAQH and PECOS logins, is collected in the first session.
> - The duplicate rule is now the same NPI twice in the same group. The same NPI in another group adds a group assignment.

**Status:** vision / planning only. No code. Revised 2026-10-16 after PM review: periodic detection dropped, hours-based success metric added (§1.5), gateway build inventory added (§1.6), client-initiated trigger and the client login added (§1.7).
**Date:** 2026-10-16
**Scope of this document:** Stage 1 of a three-stage chain — research panel and
blind-spot audit (1.1), competitive benchmarking (1.2), new-hire detection and
ingestion trigger matrix (1.3), and the pre-filled-profile vs open-org-URL
architecture decision (1.4), the success metric (1.5), the gateway build inventory (1.6), landing the trigger on the client (1.7), the two-workflow split with owners (1.8), the EHR entry point (1.9), and the draft Minimum Data Set (1.10). Stages 2 (org "pizza tracker" + chaser loop) and
3 (SSN / CAQH / PECOS capture, buy vs build) are deliberately not here.

---

## 0. What already exists (the zero-overbuild inventory)

Every recommendation below repackages one of these. Nothing in Stage 1 proposes
a new form.

| Surface | What it is today | Reusable for |
| --- | --- | --- |
| `/capture/$token` (`party_capture_links`, E0.5) | Public, no-session, one-time **org contact** capture. 256-bit token, only the SHA-256 hash stored, 72h expiry, single-use, `active/used/expired/revoked`, uniform "invalid" responses, **in-Postgres rate limiting on the anon RPCs** (E0.8 F0.8.8). Pre-fills the form from the party's `current` data behind the bare link. | The token lifecycle, lockdown screens, throttle, and the "`Shell` with the shield mark" landing chrome. |
| `/ssn-intake/$token` (`provider_ssn_intake_links`, E4.4) | Public, **provider-bound, write-only** SSN ingress into the pgcrypto vault. Same token machinery. Link is copied to the clipboard by the operator (`SsnIntakeLinkDialog`) and pasted into the operator's own email. | The provider-bound token pattern, and the fact that sensitive capture is already a *separate, later* step from identity/profile capture. |
| `/client-invites/claim/$token` (E6.12) | Claim of client (org-rep) access; requires an existing verified Supabase Auth account. | Evidence that "create a login first" is already a known friction point, kept to org reps only. |
| `pending_invites` + `invite-member` edge function | Staff (admin/specialist/billing) invitations via the Supabase Auth (GoTrue) invite email. | The only automated outbound email path in the system today — and it is for **staff**, not providers. |
| `/providers/new` (`ProviderForm`, `providerFormShared.ts`) | The provider onboarding form: identity, contact, per-state licenses (`state_licenses`), group/facility assignment. | **This is "the existing form."** The provider-facing flow renders *this* field set, not a new one. |
| `ProviderRosterForm` (wizard) + per-section CSV import (`import_runs.entity_kind`, E3.0/E3.1/E3.3) | Bulk path. Committed rows land `verification_state = 'pending_verification'` and are fenced out of readiness and generation until verified. | The staging fence is exactly the "unverified self-registration" bucket Stage 1 needs. It already exists. |
| Provider state already in the DB | `status ∈ onboarding/active/terminated`; `verification_state ∈ verified/pending_verification`; `reference_only`; `is_test_provider`; `email`, `npi`, `caqh_id` columns; `provider_field_verifications` (repo migration, operator-apply pending). | Stage 2's tracker is derived from these plus `deriveProviderGaps` / `evaluateEnrollmentReadiness`. No new status column. |
| `inbound_leads` + `/contact` | Public anon form with honeypot and rate limit, lands in a triage queue. | The pattern for "an unknown party submitted something; a human admits it." |
| `audit_log`, `notes` (provider-scoped, still live), `touches` (case-scoped) | Activity spines. | Invitation sent / reminder sent / submitted are `audit_log` + provider `notes` rows, not a new table. |

Two facts from this inventory shape everything else:

1. **There is no provider-facing transactional email today.** Provider links are
   clipboard-copied and sent from the coordinator's own inbox. Any automated
   trigger (1.3) needs an outbound email path. The choice (Supabase custom SMTP
   via GoTrue vs a transactional provider such as Resend/Postmark called from
   the nitro server) is a Stage 1 infrastructure prerequisite, flagged in §5.
2. **The existing capture link pre-fills data behind a bare, forwardable
   link.** That was an acceptable posture for an org's billing-contact details.
   It is *not* an acceptable posture for a provider row carrying DOB, home
   address, DEA number, and `ssn_last4`. This is the core of §4.

---

## 1.1 The research panel and blind-spot audit

### The panel

| Seat | Lens | What they are protecting |
| --- | --- | --- |
| **R1 — Clinician UX researcher** | Cognitive load, form abandonment, PII trust triggers for physicians, PTs, NPs, behavioral-health clinicians. | The provider's 12 minutes between patients, and their willingness to type a DOB into a link they did not ask for. |
| **R2 — Practice-owner / executive reporting strategist** | Operational visibility for practice managers and owners; who is accountable when revenue is blocked by an un-credentialed hire. | The owner's ability to answer "why isn't Dr. Patel billing yet?" without emailing three people. |
| **R3 — Credentialing operations lead** | CAQH ProView, PECOS, NPPES, PSV workflows; what actually blocks a payer application. | The coordinator's queue: 40 providers, 6 payers each, and the one missing field that stalls all of them. |
| **R4 — SecOps and identity architect** | Zero-trust PII capture, phishing and spoofing resistance, pragmatic buy-over-build. | The blast radius of one forwarded link, one guessed email, one spoofed domain. |

### Research framework (what the panel runs before any design is final)

| Method | Who | Output |
| --- | --- | --- |
| **M1. Trace-the-last-five-hires interviews** with 4–6 coordinators across 3 customer orgs. For each hire: how did you learn about them, what did you send, how many nudges, where did it stall. | R2, R3 | A measured baseline: days-to-first-contact, days-to-complete-profile, nudge count, abandonment points. Today nobody knows these numbers. |
| **M2. Provider think-aloud** with 6–8 clinicians (mix of new grads and 10-year veterans, mix of specialties) walking the *current* `/providers/new` field set as if it were a form sent to them. | R1 | Which fields they refuse to type (DOB, home address, SSN last 4), which they cannot answer from memory (DEA expiry, malpractice policy number), which they would rather upload than type. |
| **M3. Forwarding test.** Send an invite to a willing practice manager and ask them to "get it done" without instructions. Observe whether the link gets forwarded, pasted into a shared inbox, or printed. | R4, R1 | Empirical rate of link leakage in the real workflow. This decides whether a bare magic link can ever unlock pre-filled PII (§4 assumes it cannot). |
| **M4. Phish-plausibility review.** Mock the invite email and landing page; have 5 clinicians rate "would you open this / would you type your SSN here" against a lookalike. | R4, R1 | Trust-cue ranking: sender name, known inviter name, org branding, Minted branding, what is and is not asked. |
| **M5. Data-presence audit** over current demo/UAT orgs: for providers created by CSV, which columns are populated at commit, which are filled later, and by whom. | R3 | The real "partial profile" shape. If 80% of CSV rows arrive with name/NPI/email only, the pre-fill payload is small and the risk/benefit of exposing it changes. |
| **M6. Existing-tool review** with 2 orgs that use a payer or HR portal already (Modio, a hospital MSO form, an HRIS). | R2, R3 | What they already tolerate; what they would refuse to duplicate. |

### Top 3 hidden failure modes per seat, and the validation question each forces

**R1 — Clinician UX researcher**

1. **The "unsolicited-form reflex."** A clinician who receives a vendor-branded
   form asking for DOB and licenses, from a company they have never heard of,
   treats it as spam or phishing by default. The practice manager's name is
   the trust anchor, not the vendor's. *Validation question:* does the first
   screen name a human the provider already knows, and does the provider trust
   that cue more than a Minted logo? (M4.)
2. **The "I'll finish it later" cliff.** Any form that cannot be saved and
   resumed is abandoned at the first field the clinician cannot answer from
   memory (malpractice policy number, DEA expiry, graduation date). A 72h
   single-use link converts "later" into "never" and generates an admin
   ticket. *Validation question:* what fraction of the field set can a
   clinician complete from memory in one sitting, and does the flow survive a
   7-day gap? (M2.)
3. **Typing what the system already knows.** Asking a provider for their NPI,
   taxonomy, and practice address when NPPES publishes all three reads as
   laziness and erodes trust in every subsequent question. *Validation
   question:* which fields can be pre-filled from a public source with zero PII
   exposure, and does pre-filling them measurably reduce abandonment? (M2, M5.)

**R2 — Practice-owner / executive reporting strategist**

1. **The invisible queue.** The owner learns a hire is not credentialed when
   the first claim denies, six weeks in. Nothing today tells an org admin "you
   have 2 providers who have not submitted." *Validation question:* can the
   admin answer "who is stalled and on whom" from one screen, derived from
   data we already hold? (Stage 2, but Stage 1 must not create states that
   cannot be rolled up.)
2. **Accountability ambiguity.** When a provider stalls, is it the provider,
   the office manager, the coordinator, or Minted? Chasers that do not name the
   owner of the next step produce blame, not movement. *Validation question:*
   does every state in the flow have exactly one accountable party, and is that
   party derivable (not hand-set)?
3. **Scale cliffs.** A 3-location group hiring 12 PTs for a new clinic does
   not want 12 quick-invite clicks; a solo practice hiring one NP does not want
   a CSV. *Validation question:* does the trigger design handle 1 and 50 with
   the same underlying machinery (M1 for the actual distribution)?

**R3 — Credentialing operations lead**

1. **Identity collisions.** The same provider exists under a personal email in
   CSV row 14 and under a work email in the self-registration; or they already
   exist in *another org* on the platform (locums, multi-group clinicians).
   Duplicates poison the 4-part case key. *Validation question:* what is the
   dedupe key at ingestion (NPI is public and near-universal for billing
   providers; new grads may not have one yet), and what happens on a partial
   match? (§4 answers this.)
2. **Profile-complete is not credentialing-ready.** A submitted form with a
   CAQH ID is useless if CAQH is not attested or not authorized to the group.
   The coordinator's real blockers (attestation, PECOS access, primary-source
   verification) sit *after* the form. *Validation question:* which of the
   existing derived gaps (`deriveProviderGaps`, readiness) must the provider see
   during intake, so the form asks for what unblocks a payer, not what fills a
   row?
3. **Stale pre-fill.** Pre-filling from a CSV uploaded 4 months ago, or from a
   prior org's record, puts wrong data in front of the provider as if it were
   authoritative; providers skim and accept. *Validation question:* does the
   pre-filled form mark provenance and age per field ("from your group's roster,
   June 2026") and require explicit confirmation of the fields that feed payer
   applications?

**R4 — SecOps and identity architect**

1. **Forwardable secrets.** A magic link that unlocks PII *is* the PII. In
   clinics, links get forwarded to office managers, pasted into shared inboxes,
   and printed. *Validation question:* can any link in the design, if
   forwarded, reveal a provider's data without a second factor bound to that
   provider's inbox at session time? The design answer must be no. (M3.)
2. **Oracles and enumeration.** A public org URL plus a "does this provider
   exist?" lookup becomes an API for confirming which clinicians work where,
   and which orgs are Minted customers. *Validation question:* does every
   pre-verification response look identical regardless of whether a match
   exists, and is the throttle already in place (E0.8) applied to the new RPCs?
3. **Capturing the crown jewels at the wrong moment.** Asking for SSN or
   portal passwords on the first touch, or on any screen reachable from a
   public URL, trains providers to type secrets into forms and is exactly what
   a lookalike page would do. *Validation question:* is sensitive capture
   (SSN, CAQH/PECOS credentials) strictly a separate, later step, reachable
   only after verified identity and admission by an org admin? (Stage 3; but
   Stage 1 must guarantee the gateway never asks.)

---

## 1.2 Competitive benchmarking

Vendor claims below come from the vendors' own pages and guides; none were
independently verified. Sources at the end of this section.

| Platform | Mid-cycle intake pattern | Pre-population | Where it helps clinicians | Where it creates friction |
| --- | --- | --- | --- | --- |
| **Modio OneView** | Admin adds provider → sends invitation (templated email, attachments such as a welcome packet; custom templates via account manager). Provider claims a profile. Team page shows status icons including "not yet invited." | Admin-entered data is the seed; provider fills guided sections; document requests (CV, photo). | Guided sections, explicit document requests, visible per-provider status for the org. | **Provider must create an account (email + password), and the email must match the invited address.** Account creation is the classic abandonment point. Email-mismatch failures generate support tickets. |
| **Verifiable** | "Prescreen" intake: secure digital links for data missing from CAQH or specific to the org; conditional smart forms request only needed fields. | CAQH ProView and real-time NPI lookup populate the application; data entry errors flagged in-session. | Asks only for the delta; fills from authoritative sources; claims intake drops from ~30 to ~10 minutes. | Depends on a CAQH integration (contractual, participating-org status) and on the provider having a current CAQH profile. New grads without CAQH fall back to a full form. |
| **Medallion** | Kick off credentialing from ~5 provider data points via API or CAQH integration; provider onboarding and CAQH sync are workflow steps. | CAQH-centric. | Minimal admin input to start. | Same CAQH dependency; the platform is sized for payers and large groups. |
| **Assured** | AI-native; ATS/EMR/Salesforce integrations so a new hire in the HR system seeds the credentialing record. | From the hiring system of record. | Zero re-keying for orgs that have an ATS. | Enterprise integration surface; small groups have no ATS to connect. |
| **symplr Provider (ex-Cactus)** | Practitioner uploads once; documents shared across the health system's entities; application-through-recred lifecycle. | Hospital-grade application forms. | Upload-once across entities. | Legacy, heavyweight, multi-section applications; industry sources cite providers "not knowing where their application stands." A ServiceNow redesign at one health system counted up to 18 redundant data requests per provider before fixing it. |

### Industry patterns, synthesized

1. **Start from the minimum.** The winning admin action is name + email (+ NPI).
   Everything else is pulled or asked for later.
2. **Pull before you ask.** NPPES is public and free; CAQH is the richer source
   but contractual. Modern tools pre-fill from a source of truth, not from the
   provider's memory.
3. **Ask only the delta, conditionally.** Smart forms that show what is missing
   beat full applications.
4. **Password accounts are the abandonment cliff.** The legacy pattern (Modio,
   symplr) requires a login; the modern pattern (Verifiable links) does not.
5. **The org wants status per provider,** and the provider wants to know where
   they stand. Both are derived views, not workflow engines.
6. **Welcome-packet embedding is real** (Modio's attachment support exists
   because orgs send packets). An org-level entry point belongs in that packet.

### What Minted Panel should adopt vs avoid

| Adopt | Avoid |
| --- | --- |
| Name + email (+ NPI) as the complete admin input to start an onboarding. | A provider login/password. Providers get sessions, not accounts (Stage 3 may revisit for credential rotation; not for intake). |
| **NPPES lookup at the gateway** to pre-fill name, credentials, taxonomy, enumeration date, and practice address. Public data, zero PII risk, free API, no vendor contract. | A CAQH ProView integration *now*. Contractual, and Minted's customers are small/mid groups whose new grads often lack a CAQH profile. Revisit when a customer is large enough to justify participating-org status. |
| Render the existing `ProviderForm` field set as a **delta view**: pre-filled fields shown for confirmation, missing fields asked, with per-field provenance. | A new multi-section "application." The form is the form. |
| Save-and-resume as a property of the verified session, with a provider-initiated "send me a new code" on expiry. | 72h single-use links as the only re-entry path for a multi-field form. |
| Per-provider status derived from existing columns (Stage 2). | A new onboarding-status column or table. |
| Org-named, human-named invitations ("Dana at Shelby Sports Rehab asked us to collect…"). | Vendor-only branding on the first touch. |
| HRIS/ATS integration as a *future* trigger behind the same ingestion RPC. | Building an integration surface before a customer has an ATS to connect. |

Sources: [Modio OneView provider onboarding tip guide](https://www.modiohealth.com/life/wp-content/uploads/OneView-Tip-Guide-How-to-Onboard-Providers-.pdf), [Modio OneView quick start guide](https://www.modiohealth.com/life/wp-content/uploads/Modio-OneView-Quick-Start-Guide.pdf), [Verifiable Prescreen](https://verifiable.com/prescreen), [Verifiable provider onboarding](https://verifiable.com/provider-onboarding), [Medallion credentialing for payers](https://medallion.co/products/credentialing-for-payers), [Assured Series A coverage, Fierce Healthcare](https://www.fiercehealthcare.com/finance/startup-assured-banks-19m-series-ai-native-credientialing-provider-enrollment), [Assured key features](https://www.withassured.com/blog/key-features-of-assured-credentialing-solution), [SCL Health provider onboarding case study](https://www.cprime.com/resource/case-study/scl-health-elevates-the-provider-onboarding-experience), [symplr Provider discussion, G2](https://www.g2.com/products/symplr-provider/discuss).

---

## 1.3 New-hire detection and ingestion trigger matrix

**Speed is the requirement.** The success metric for this program is hours from
invitation to completion (§1.5), so every trigger below is evaluated on how
fast it gets a link into the provider's hands. Periodic detection (a monthly
"any new hires?" check-in) was considered and **rejected**: a 30-day detection
window cannot serve an hours-based target. Detection is real-time or it is not
a trigger.

All triggers land in the **same place**: a provider row (new or existing) with
`status = 'onboarding'` and, when the row was not asserted by an admin or a
coordinator, `verification_state = 'pending_verification'` — the fence that
already keeps CSV-imported rows out of readiness and generation. The trigger is
the front door; the room behind it is shared, and every door calls one
ingestion RPC.

Triggers are organized by **who pulls them**, because that is what decides
latency: the person who knows about the hire first should be the one who can
start the onboarding, in minutes, without relaying through anyone.

| Dimension | **T1. Coordinator Quick-Invite** (Minted staff, full panel) | **T2. Client Quick-Invite** (the org's own admin, in the restricted client login — §1.7) | **T3. Org self-service URL** (`/join/<org>` in the offer letter / welcome packet) | **T4. CSV re-import → invite net-new rows** (reuse) |
| --- | --- | --- | --- | --- |
| **Trigger mechanism** (how it starts, who owns it) | `+ Add` → "Invite provider" on `/providers`: name + email (+ NPI, + group/facility). Creates the row (`onboarding`, `verified` — a coordinator asserted the hire) and the invitation. **Owner: Minted coordinator.** | The same three fields on the client's own screen, inside the E6.12 client context, as that context's single write. Creates the row `verified` (the org's admin asserted the hire), stamps the client as inviter, emails the invitation. **Owner: the practice manager, the moment they know.** | The org embeds a persistent URL in the offer letter and welcome packet. The provider opens it unprompted, before day one. Lands `pending_verification`. **Owner: the org's HR process.** Organizations have no `slug` column today — one additive column. | Coordinator uploads the org's current roster CSV (already supported per section). Rows with no roster match stage `pending_verification`; the commit screen offers "invite these N providers." **Owner: Minted coordinator.** |
| **Latency to the provider's inbox** | Minutes after the coordinator learns of the hire — but the coordinator learns second-hand (an email from the client), so real latency is "client email → coordinator reads it → clicks." Hours to days. | **Minutes after the hire is known.** No relay. This is the trigger that makes the hours target reachable. | **Negative latency**: the provider can start before their first day. Depends on the org actually embedding the link. | Hours, batched: whenever the coordinator next uploads. Right for 10–50 hires, wrong for one. |
| **Delivery and friction** (steps to the provider's hands) | Coordinator: 1 screen. Provider: 1 email → gateway → code → form. Requires the outbound email path (§5.1); today's analogue is clipboard copy, kept as a fallback channel. | Client: 1 screen, same three fields, in a login they already hold for the tracker (Stage 2). Provider: identical to T1. | Client: zero steps per hire (a one-time packet edit). Provider: finds the link → gateway → identity + code → form. The link must be short and typeable; packets are often PDFs or paper. | Coordinator: upload + review + one checkbox. Provider: as T1. |
| **Scalability** (1 hire vs 50 across locations) | 1–5 comfortably. 50 is 50 dialogs. | Same as T1 on the client side; a client hiring 50 will send a spreadsheet to the coordinator (T4). | Unbounded on the admin side; 50 unprompted self-registrations arrive as 50 `pending_verification` rows to admit and assign. | Built for 50. Group/facility assignment rides the CSV columns. |
| **Provider and admin experience** | **Coordinator:** fastest internal path. **Provider:** an expected email naming the practice and the coordinator. | **Client:** "I hired someone" becomes a 30-second action instead of an email to Minted and a wait. **Provider:** the invitation names their own practice manager — the highest-trust sender possible. | **Client:** no action, no awareness until a submission lands; must then admit, dedupe, and assign (or the coordinator does). **Provider:** convenient if the packet is where they already look; confusing if a T1/T2 invite also arrives — the gateway resolves both to one session, so no double record. | **Coordinator:** the familiar import screen. **Provider:** as T1. |
| **Security and attack surface** | Narrow: invitation bound to an asserted email; the link identifies the invitation only; data unlocks on a session-time code (§1.4). No public lookup, no enumeration. | Same narrow surface. The client's write is server-authorized through the E6.12 service-only gateway (`p_actor_user_id` from the verified JWT, `client_access` + group grant re-checked), so a valid client login cannot invite into a group it is not granted. Audited as the client's action. | Widest: a public, long-lived URL. Spam / junk registrations are contained by the existing honeypot + in-Postgres throttle + the `pending_verification` fence (nothing a stranger submits reaches readiness or generation). Org enumeration (`/join/best-pt` confirms a customer): accept, or use an opaque code. Lookalike phishing: mitigated only by the gateway **never** asking for SSN or credentials, so a fake page and the real page differ in what they ask. | As T1; the CSV path already enforces "SSN reject-never-truncate." |
| **Trust impact** (why a clinician will or won't trust it) | High: names the practice and a Minted coordinator. | **Highest:** names the practice manager who hired them. The provider was told to expect it, by the person who told them. | Medium: trust borrowed from the welcome packet; the landing page must show the org's name immediately to close the loop. | As T1. |

### Deferred, not rejected

- **HRIS / ATS webhook.** When a customer has a system of record for hires, a
  signed webhook calls the same ingestion RPC T1–T2 use. Nothing else changes.
  Build when the first such customer exists.
- **Minted-side notification on every new invitation** (a post to an internal
  channel, or a row on the coordinator's queue) is part of Stage 2's tracker,
  not a trigger. Minted learns of a hire the moment T2 or T3 fires, not on a
  schedule.

### Panel verdict on triggers

- **T1 and T2 are one build.** They are the same dialog and the same ingestion
  RPC, mounted in two contexts (the full panel and the restricted client
  context). T2 is the one that meets the hours target, because it removes the
  relay through Minted. See §1.7 for what "landing it on the client" entails.
- **T4 ships with T1** because it is a checkbox on the existing import commit
  screen and is how 50 hires actually arrive.
- **T3 is a fast follow.** It is T1's gateway with the org resolved from the
  URL instead of from an invitation, plus an org identifier. It is the only
  trigger with negative latency, so it is worth doing soon, but it cannot be
  first: it needs the admission step on the tracker (Stage 2) to be useful.

---

## 1.4 Pre-filled profile vs open org URL: the gateway decision

### The tension, stated precisely

The system holds partial provider rows (from CSV, from a quick-invite with
NPI, from a prior org). The provider should confirm and complete, not re-type.
But a pre-filled provider row contains DOB, home address, DEA number,
`ssn_last4`, license numbers. Showing that behind anything that can be forwarded
is a breach waiting for a forwarded email.

A security principle settles most of this: **the link is the door, the code is
the key.** A link may carry *which org* and *which invitation*; it may never, by
itself, unlock a row. Proof of control of the bound inbox at session time is the
unlock. The existing capture link skips this (it pre-fills behind the bare
token). For provider PII that shortcut ends.

### Option A — Dual entry paths

- **Path 1:** tokenized one-time magic link (existing `*_links` pattern) that
  unlocks pre-filled data after an email OTP or NPI check.
- **Path 2:** public org URL that renders blank until verified.

### Option B — Unified gated entry

Both the invitation link and the org URL land on one gateway. The provider
enters name + email (+ NPI if they have one), receives a one-time code at that
email, and the system then loads the existing form: pre-filled if a verified
match exists, blank if net-new.

### Head-to-head

| Criterion | Option A (dual paths) | Option B (unified gateway) |
| --- | --- | --- |
| **Friction for an invited provider** | Click → (OTP) → form. If the OTP is required, A and B are equal. If A skips the OTP for the link path, A is one step shorter — but then the link alone unlocks PII (fails the forwarding test). | Click → email is pre-filled from the invitation → code → form. One extra step versus a bare link; identical to A-with-OTP. |
| **Friction for a packet (org-URL) provider** | Blank form. Even if the coordinator loaded their CSV row last month, Path 2 cannot use it — so the provider re-types what the org already has, which R1 names as a trust-eroding failure. | Same gateway; if their email + NPI resolve to an existing verified row, they get the pre-filled delta view. The org's prior work is honored regardless of which door they came through. |
| **Two doors, two behaviors** | A provider who receives both a packet link and an invite sees two different experiences; support load follows. | One behavior. The invitation link is just the gateway with fields pre-filled and the org pinned. |
| **Security of pre-filled PII** | Depends on whether Path 1 insists on the OTP. The NPI "verification" alternative is not a factor: NPI is public (NPPES). | Always: pre-fill is shown only after a session-time code to the bound inbox. A forwarded link or a guessed (email, NPI) pair yields nothing without inbox control. |
| **Oracle / enumeration** | Path 2's "renders blank until verified" still needs a verification that implies a lookup. | Must be designed so the response to "send me a code" is identical whether or not a match exists ("If this matches a record, a code is on its way"). The existing uniform-invalid pattern and in-Postgres throttle cover this. |
| **Identity collisions** | Unaddressed by the pattern; left to the coordinator. | Addressed at the gateway: email match → pre-fill; NPI match with a *different* email → **no pre-fill** (inbox not proven), proceed blank, and flag the submission as a probable duplicate for the coordinator to merge. The provider is never told a record exists. |
| **Resume after abandonment** | Path 1's single-use link forces a re-issue by an admin. | The gateway is the resume mechanism: come back, enter email, get a code, continue. No admin ticket. |
| **Build surface** | Two routes, two validation RPCs, two sets of lockdown states, plus the OTP. | One route (`/join/$org` with optional `?invite=`), one gateway RPC, one code-verify RPC, one existing form. The token machinery and lockdowns are reused as-is for the invitation; the only new primitive is the short-lived email code. |
| **Account creation** | None in either. | None. A verified gateway session is a short-lived server-side session bound to the provider row, not a Supabase Auth user. (Supabase GoTrue's built-in email OTP would create an auth user per provider; the panel can use GoTrue only as the *mailer*, or a transactional provider — decision in §5.) |

### The NPI question

NPI adds no secrecy (public) and should never be treated as a factor. It adds
**matching precision** and **pre-fill from NPPES**. Rule: ask for NPI "if you
have one"; a missing NPI is allowed (new grads) and routes the row to
`pending_verification` with a visible "No NPI yet" gap, which `deriveProviderGaps`
already emits as `missing_npi`.

### Panel recommendation: **Option B, with the invitation link as an accelerator**

The panel is unanimous on B, for four reasons:

1. **It is the only option that honors the org's prior data on both doors.**
   Option A's Path 2 wastes the CSV the coordinator already loaded.
2. **It makes the forwarding test pass by construction.** No link unlocks PII;
   the code does. The existing capture link's bare-token pre-fill is not
   extended to providers.
3. **It is less to build.** One gateway, one form, one code primitive, reusing
   the invitation-token lifecycle, lockdown screens, and throttle exactly as
   they are.
4. **It is the resume mechanism.** The gateway is how a provider comes back on
   day 8 without a coordinator re-issuing anything; this is the precondition
   for Stage 2's chaser loop not generating admin tickets.

The trust posture of the gateway (what R1 and R4 require it to show):

- The org's name first, then "invited by Dana S." when an invitation exists,
  then Minted as the operator ("secure intake by Minted Panel").
- A plain statement of what will be asked in this session and what will
  **never** be asked here: no SSN, no portal passwords, no payment. Sensitive
  capture is a separate, later, admin-admitted step (Stage 3).
- Per-field provenance and age on pre-filled data ("from Shelby Sports Rehab's roster,
  Aug 12") with explicit confirmation on the fields that feed payer forms.
- Save-and-resume messaging on the first screen, so the "I'll do it later"
  cliff becomes "come back any time with your email."

Adopted decisions from this section to carry into Stage 2:

- Ingestion resolves to the existing provider row and the existing
  `status` / `verification_state` pair. No new status column.
- "Invitation sent," "code verified," "submitted" are `audit_log` and provider
  `notes` events; Stage 2 derives the tracker from them plus the gaps lib.
- Coordinator **admission** (flip `pending_verification → verified`, assign
  group/facility) is the hand-off to credentialing and is already a UI action.

---

## 1.5 Success metric: hours to onboarding completion

> **PM rule (2026-10-19): a target applies only to a span Minted controls.**
> Minted controls nothing before the provider is ready and has submitted their
> information. So the two provider-side spans below (first touch, time to
> submission) are **monitored, never targeted**; the targets stand only on
> Minted's spans: submitted → ready for credentialing (8 business hours) and
> ready → first payer application filed (target to be set). The owner view and
> the report label provider spans "measured for monitoring · no targets".


Every stage boundary in this design is an `audit_log` row with a timestamp:
invitation created, code verified, submitted, admitted. The metric is therefore
a query over rows the design already writes; no instrumentation is added.

| Metric | Measured as | Proposed target (to confirm) |
| --- | --- | --- |
| **Time to first touch** | invitation created → first `code_verified` | under 4 business hours, median |
| **Time to submission** (provider side) | invitation created → `self_submitted` | under 24 hours, median |
| **Time to admission** (org/Minted side) | `self_submitted` → `verification_state = 'verified'` with group and facility assigned | under 8 business hours, median |
| **Onboarding completion rate** | invitations that reach `admitted` within 7 days ÷ invitations created | ≥ 85% |
| **Admin re-issue rate** (friction signal) | invitations re-sent by a human ÷ invitations created | < 10% |

Each design choice in §1.4, §1.6 and §1.7 is justified against these numbers:
no password account (time to first touch), self-serve resume (completion rate
and re-issue rate), client-initiated invite (time to first touch, since the
relay through Minted is removed), NPPES pre-fill (time to submission).

## 1.6 Build inventory: the gateway is one route, one table, three RPCs, the existing form

The unified gateway is the **smaller** build, not the larger one. Everything in
it is a copy of a surface that already exists.

| Piece | What gets built | What it copies |
| --- | --- | --- |
| Route `/join/$org` (with optional `?i=<invite>`) | One chromeless public route with three screens: identify, code, form. Added to the public list in `__root.tsx`. | The `Shell` and lockdown screens of `/ssn-intake/$token`, verbatim. |
| Table `provider_intake_links` | The E4.4 link row (org, provider, bound email, token hash, state, expiry) plus three columns: code hash, code expiry, session expiry. `provider_id` nullable until a net-new submission creates the row. | `provider_ssn_intake_links`, copied. No second table for codes or sessions. |
| RPC `request_intake_code(org, email, npi?, invite?)` | Always answers "if this matches, a code is on its way." Sends a six-digit code to that inbox. Five attempts, ten-minute expiry. | `validate_capture_token`: anon, SECURITY DEFINER, already covered by the E0.8 in-Postgres throttle. |
| RPC `verify_intake_code(link, code)` | Returns a short-lived session token (hash stored on the same row) and the pre-fill payload, or a uniform failure. | The same hashed-token check the links already do. |
| RPC `submit_intake(session, payload)` | Upserts the provider row and `state_licenses` with the same validation `/providers/new` uses, writes the audit row, flips the link to `used`. | `submit_capture`, with the provider field set instead of the contact field set. |
| Email | One template: org name, inviter name, the link, and the sentence "we will never ask for your SSN or any password on this page." | Needed for any trigger at all; not gateway-specific. |
| Form screen | Renders the existing `ProviderForm` field set, pre-filled fields marked with provenance and age. | No new form. |
| Gate coverage | One assertion block in `scripts/verify-org-isolation.mjs` for the new anon RPCs. | The existing gate. |

What the provider experiences, counted honestly:

1. Opens the email, taps Continue. The gateway already knows the org and the
   email from the invitation, so screen one is a single button.
2. Opens the code email, types six digits.
3. Fills the blanks on a form that already shows what the org knows, taps
   Submit.

Why it is smaller than the dual-path alternative:

- Option A needs two routes, two validation paths, two lockdown sets, and
  still needs a code to make a forwarded magic link safe. The gateway is that
  code step with the second route deleted.
- Resume is free: a provider who leaves on day two comes back, enters their
  email, gets a code, continues. Option A needs a human to re-issue a link —
  the ticket the re-issue-rate metric exists to catch.
- It is reused three times. Stage 2's nudges all point at it; Stage 3's SSN
  and credential capture load inside the same verified session. Two bespoke
  doors are what would be complicated.

## 1.7 Landing the trigger on the client: the "additional login"

The hours target is only reachable if the person who knows about the hire first
can start the onboarding without relaying through Minted. That person is the
practice manager or owner — **the client** — and today the client has no seat
in the panel from which to act. Three facts bound the design:

- Panel memberships (`admin` / `specialist` / `billing`) are **Minted staff
  seats** with org-wide read of provider PHI. Giving a client one of these to
  press one button is wrong by scope.
- E6.12 already built a **restricted client context**: a verified auth user,
  a `client_access` row (one org), explicit `client_group_grants`, no
  memberships row, read-only, limited to the Enrollment Explorer, every
  request re-authorized server-side through service-only gateways that take
  `p_actor_user_id` from the verified JWT.
- That context is claimed through `/client-invites/claim/$token`, which
  requires the recipient to **already hold a verified auth account**; E6.12
  explicitly left outbound email and account provisioning out of scope.

### The decision

**Extend the existing client context with exactly one write — "Invite a
provider" — rather than create a new role or a new login surface.** The
client's login is the "additional login," and it is one login per practice for
the life of the relationship, not one per hire. It is the same login Stage 2's
tracker will use, so the client gets both the button and the visibility from
one seat.

| | Option 1: make the client a panel `admin` | **Option 2: one write on the E6.12 client context (recommended)** | Option 3: no client login — org URL and "email your coordinator" only |
| --- | --- | --- | --- |
| What the client can do | Everything a Minted admin can: all providers, PHI, settings, payer setup. | Invite a provider into a group they are granted; see the Stage 2 tracker for those groups. Nothing else. | Nothing in the panel. Providers self-start via the packet link; one-off hires go by email to Minted. |
| Latency to the provider's inbox | Minutes. | **Minutes.** | Negative (packet) or hours-to-days (relay). |
| Blast radius of a compromised client login | The whole org's PHI. | One invitation into one granted group, audited as that client; the provider's data still unlocks only via the provider's own inbox code. | None (no login). |
| Build | Zero, and unacceptable. | One client-context screen (the same invite dialog mounted in the restricted shell), one service-only gateway that re-checks `client_access` + group grant and calls the shared ingestion RPC, one gate assertion. | Zero. |
| Prerequisite | – | **Client account provisioning** (below). | Org slug (T3). |

### What "additional login" costs, and how to keep it small

- **No password.** The client signs in with an email magic link or one-time
  code through Supabase Auth, the account provisioned by Minted once when the
  org goes live (the same moment the org's `client_invites` row is issued).
  This closes the E6.12 gap ("recipient must already hold an account") with
  the mailer §5.1 requires anyway. No new auth system.
- **One seat per practice, issued once.** The onboarding conversation with a
  new customer already ends with "here is your link"; the link now also lands
  the invite button and the tracker.
- **Fail-closed by construction.** A client with no group grant sees the
  tracker empty and the invite dialog's group selector empty. A client cannot
  invite into a group they cannot see.
- **The client is never asked to be an operator.** Admission (flipping the
  fence, assigning facilities), dedupe, and credentialing stay with Minted's
  coordinators. The client's write is the one thing only they know: "we hired
  this person."

### How it lands, end to end, in minutes

1. Practice manager signs an NP on Tuesday at 2:10 pm. Opens the client link
   she already uses for the enrollment report. Taps **Invite a provider**:
   name, email, NPI if the NP has one, picks the group (the only group she is
   granted). Taps Send. 2:11 pm.
2. The gateway invitation is in the NP's inbox at 2:11 pm, from "Dana Shelby via
   Minted Panel for Shelby Sports Rehab," reply-to Dana.
3. A Minted coordinator's `/providers` Onboarding grouping (Stage 2) shows the
   new row at 2:11 pm with "Invited by Dana S. (client)."
4. The NP taps Continue at 2:40 pm between patients, enters the code, sees
   her NPPES-filled name and taxonomy, completes the rest that evening, submits.
5. Wednesday 9:05 am the coordinator admits the row, assigns the facility, and
   generation can see her. Invitation to admitted: under 20 hours.

---

## 1.8 Two workflows, two owners (scope clarification, 2026-10-17)

Everything above commingles two workflows that have different owners, different
completion criteria, and different failure modes. They are separated here and
every later section, mock, and tracker stage is read against this split.

| | **Workflow A — Create the provider record** | **Workflow B — Complete the record to the Minimum Data Set** |
| --- | --- | --- |
| **Question it answers** | "Does Minted know this person was hired?" | "Does the record hold everything needed to begin credentialing?" |
| **Owner** | The **practice** (owner / office manager via the client login), or the practice's **system of record** (EHR / HRIS, §1.9) acting for it. Minted coordinators own it only for bulk (CSV). | Split by field owner: the **provider** for provider-owned fields (identity, contact, licenses, CAQH), the **practice** for group-owned facts (facility assignment, W-9, COI, contract), **Minted** for verification, dedupe, and admission. |
| **Input** | Tier 0 of the MDS (§1.10): name + email, optional NPI, group, start date. | The rest of the MDS, field by field, from whoever already holds it. |
| **Output** | One `providers` row, `status = 'onboarding'`, `verification_state` by provenance (asserted by practice/coordinator → `verified`; self-registered → `pending_verification`), one `audit_log` CREATE row carrying the **source** (`client_invite`, `coordinator`, `join_link`, `csv`, `ehr`). | The same row with Tier 1 satisfied **and** `verification_state = 'verified'` **and** a primary group + facility assignment — which is exactly the existing readiness fence. Admission is the explicit hand-off to credentialing. |
| **Ends when** | The row exists. Seconds. | The row is admitted. Target: under 24h to submission, under 8 business hours for Minted's step (§1.5). |
| **Typical failure** | Minted never learns of the hire (the relay problem T2 removes). Duplicate rows (NPI dedupe at the seam). | The provider stalls on fields they cannot answer from memory; the practice never assigns a facility; Minted sits on a submitted row. |
| **What the tracker shows** | The row's existence and its source. | Stages Invited → Started → Submitted → Admitted (Stage 2 §2.1). |

Design consequences:

1. **One ingestion seam, many doors.** Every Workflow A entry (quick-invite,
   client invite, join link, CSV, EHR) calls the same `ingest_provider` path
   with a `source` and, where the source supplies fields, a **per-field
   provenance** (`source`, `as_of`). The provenance seam is the existing
   `provider_field_verifications` table (one row per `(provider_id,
   field_key)`, keyed by the bare catalog token, repo migration S6.1 pending
   operator apply). No new table.
2. **Workflow B is a delta, never a form.** The gateway renders the existing
   `ProviderForm` field set minus whatever a source already supplied, with each
   pre-filled field labelled by its provenance ("from your EHR · Oct 2"). A
   record created by an EHR with Tier 0 + licenses + taxonomy leaves the
   provider only Tier 1 blanks the EHR does not hold.
3. **Owners are explicit on every row.** The tracker's "waiting on" sentence
   (owner view) names the person or party because the MDS assigns each field
   an owner; a row is never "stalled" without someone accountable.
4. **The practice's group-owned facts are Workflow B too**, but they are
   collected once per group in the existing onboarding wizard, not per hire.
   A hire into a group that already has W-9, COI, contract, and facilities
   inherits them; the provider is never asked for them.

## 1.9 Entry points, revisited: the EHR as a Workflow A door

The practice already keys the new hire into its EHR or practice-management
system on day one (scheduling, billing, provider directory). Every field
re-typed into Minted after that is the re-entry burden this program exists to
remove. An EHR integration is therefore a **Workflow A trigger** (T5), on the
same seam as T1–T4, and later a **reverse channel** that pushes credentialing
outcomes back so the practice never re-keys payer IDs either.

| | **T5. EHR / PM system integration** |
| --- | --- |
| **Mechanism** | The practice's EHR exposes practitioners through its API (FHIR R4 `Practitioner` + `PractitionerRole`: name, NPI, telecom, address, qualifications/licenses, specialty taxonomy, organization and location links). A connector polls or subscribes, and on a new or changed practitioner calls `ingest_provider` with `source: 'ehr'` and per-field provenance. **Owner: the practice** — the EHR is the practice's system, so the row lands `verified` like a client invite. |
| **Latency** | Minutes from the EHR entry. Negative relative to Minted's current knowledge. |
| **What it supplies** | Tier 0 plus, typically, taxonomy, practice phone/address, state licenses with numbers and expiries, sometimes DEA. **Never** SSN, DOB is EHR-dependent, home address rarely. Workflow B still runs for the remainder, as a delta. |
| **Dedupe** | NPI is the join key; an EHR practitioner matching an existing row updates provenance and fills blanks, never overwrites a provider-confirmed value. |
| **Security** | A signed, per-practice credential held server-side; the connector writes only through the ingestion RPC; the extension's locked contracts are untouched. Gate assertions cover the new RPC. |
| **Trust** | The provider is told "from your EHR" on each pre-filled field; the invitation still comes from the practice. |
| **When** | Deferred until a customer names an EHR with an API they will authorize. The seam is built now so T5 is a connector, not a redesign. |
| **Reverse channel (later)** | On case approval, push the payer ID / effective date to the EHR or PM system's provider enrollment record, so billing setup is not re-keyed either. Same connector, outbound. Out of scope for this program; noted so the seam is designed two-way. |

Both the EHR and the Chrome extension exist to remove re-entry; the extension
removes it on the way **out** (payer portals), the EHR connector on the way
**in**. The MDS is what sits between them: the single record both fill and
both read.

## 1.10 Minimum Data Set — draft, **to be defined**

The MDS does not exist as a document today. What exists is three code-owned
derivations that between them already enforce most of it: the readiness
checks (`src/lib/enrollmentReadiness.ts`), the roster gap pills
(`src/lib/providerGaps.ts`), and generation candidacy
(`src/lib/providerFootprint.ts` + the verification fence). The draft below is
read off those, tiered, with an owner per field. **The PM defines the final
set; nothing in the mocks or the tracker depends on the exact list, only on
the tiers and the owners.**

| Tier | Purpose | Fields (owner) | Enforced today by |
| --- | --- | --- | --- |
| **0 — Create the record** | Workflow A can run | First name, last name, email **(practice)**. Optional at creation: NPI, group, facility, start date (practice). | `ProviderForm` requires only first/last; the invite dialog adds email. |
| **1 — Begin credentialing** (the MDS proper) | Admission; the readiness fence opens | NPI **(provider; EHR)** · CAQH ID **(provider; required — PM decision 2026-10-17 during mock review; the new-grad exception is withdrawn)** · CAQH attested within 120 days **(provider)** · at least one state license for each target state, with number, expiry, PSV-verifiable **(provider; EHR)** · date of birth **(provider)** · SSN last 4 **(provider)**, full SSN in the vault **(provider, Stage 3)** · home address **(provider)** · mobile phone **(provider)** · primary group assignment and ≥1 facility assignment with a footprint in each target state **(practice)** · taxonomy / specialty **(provider; EHR)** · group-owned: W-9, group COI current, contract in place, facility in state **(practice, once per group)** | Readiness checks `npi`, `caqh_id`, `caqh_current`, `license_present/current/verified`, `demographics` (DOB + SSN last 4 presence), group checks `w9`, `group_coi`, `group_contract`, `state_facility`; candidacy's facility + footprint rule; `verification_state`. Home address, phone, and taxonomy are **not** enforced today and are the panel's additions pending PM decision. |
| **2 — Per-payer** | A specific payer application | Degree, school, graduation date, DEA + expiry, malpractice carrier/policy/dates, board certification, languages, gender, Medicaid attestation, and anything a payer PDF or portal field map asks for. | Resolved per case by SOP templates, payer forms, and the field registry — **not** part of the MDS. Asked when a case needs it, never at intake. |

Rules the draft commits to:

- **Tier 1 is the admission gate and nothing else is.** A row with Tier 1
  satisfied and `verified` is admitted; Tier 2 blanks become case tasks.
- **Every Tier 1 field has exactly one owner**, and the owner is who the
  tracker names when it is missing. Provider-owned blanks are nudged to the
  provider (Stage 2); practice-owned blanks appear in the owner view's "Needs
  you"; Minted-owned steps (verification, dedupe, admission) count against
  Minted's target.
- **A field can arrive from any door** and keeps its provenance. The gateway
  asks only for what is still blank or unconfirmed.
- **Sensitive items (full SSN, portal credentials) are Tier 1 for the vault
  but never collected at the gateway's first session** — Stage 3 decides the
  capture mechanism; the MDS only records that they are required.

Open for the PM (added to §5): confirm the Tier 1 list, in particular whether
home address, mobile phone, and taxonomy are required to admit or are Tier 2;
~~whether a new grad without CAQH can be admitted~~ (decided 2026-10-17: CAQH ID
is required, matching the existing `caqh_id` readiness check); and whether the full SSN
must be in the vault before admission or before the first payer submission.

---

## 5. Prerequisites and open decisions for the PM (Stage 1 sign-off)

1. **Outbound email for providers and clients.** Choose: (a) Supabase Auth
   custom SMTP used only as a mailer, or (b) a transactional provider
   (Resend/Postmark) called from the nitro server with a DMARC-aligned
   `mintedpanel.com` sender and the inviting org's name in the display name.
   The panel recommends (b): it keeps providers out of the auth user table and
   gives the delivery telemetry Stage 2 needs. Both require DNS work on the
   sending domain. This one path serves the provider invitation, the gateway
   code, the client's magic-link sign-in, and Stage 2's nudges.
2. **Client account provisioning.** Confirm: a client account is created by
   Minted once per practice at go-live, password-less (email code or magic
   link), claimed through the existing `/client-invites/claim` route, and
   extended with the single "Invite a provider" write (§1.7). No new role.
3. **Org identifier for T3.** Additive `organizations.slug` (readable,
   enumerable) or an opaque join code (unguessable, less memorable in a printed
   packet). Panel leans slug; the enumeration risk is "this clinic is a Minted
   customer," which marketing will publish anyway.
4. **Provenance of rows.** A row created by a coordinator or a client invite
   lands `verified` (someone with authority asserted the hire); a
   self-registered row lands `pending_verification`. Confirm this reading of the
   existing fence.
5. **NPPES pre-fill at the gateway.** Free public API; no PHI. **Not built and
   not assumed:** no NPI registry integration exists in the codebase today
   (`providerGroup.ts` notes it was deferred), so the mocks make no pre-fill
   promise and NPI is an optional matching key only. Build, validate and test
   the lookup before any screen claims it (failure mode: degrade to blank
   fields).
6. **The "never ask at the gateway" list** for Stage 3: SSN, CAQH/PECOS
   credentials, DEA number (DEA is on the form today; the panel wants it moved
   to the admitted session, not the first screen).
7. **Targets in §1.5.** Confirm or adjust the numbers; Stage 2's stall
   thresholds will be expressed in business hours against them.
8. **Define the Minimum Data Set (§1.10).** Confirm Tier 1, decide the three
   open questions (home address / phone / taxonomy; new-grad CAQH; SSN timing),
   and name an owner per field. The tracker and the gateway depend only on the
   tiers and owners, not the exact list.
9. **EHR connector (§1.9).** Agree it is a Workflow A door on the shared
   ingestion seam, deferred until a customer authorizes an EHR API; the seam
   (one `ingest_provider` RPC with `source` and per-field provenance via
   `provider_field_verifications`) is built with T1 so T5 is a connector later.

**Stop.** Stage 2 (the org tracker and chaser loop) and Stage 3 (sensitive
capture, buy vs build) proceed on approval of the above.
