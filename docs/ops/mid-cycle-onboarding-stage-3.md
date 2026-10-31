# Mid-Cycle & Continuous Provider Onboarding — Stage 3

> **Amended Oct 19, 2026.** The Oct 18 to 19 design review changed parts of this doc. Where they conflict, the provider onboarding engineering handoff wins. It's in the Obsidian vault at `20 Projects/Minted Panel/Minted Panel - Provider Onboarding Engineering Handoff.md`. Changes that touch this doc:
> - The SSN and the CAQH and PECOS logins are collected in the provider's profile in the first session, not on a secure-items screen after admission.
> - §3.0 and §3.2 surrogacy-first for PECOS is replaced. The product owner decided to store PECOS logins in the vault, accepting the CMS-terms risk. CAQH organizational access stays optional.
> - The native vault extension (Option 3) stands and moves into Release 1. The 1Password interim stands.

**Status:** vision / planning only. No code. Builds on the approved Stage 1
([`mid-cycle-onboarding-stage-1.md`](./mid-cycle-onboarding-stage-1.md)) and
Stage 2 ([`mid-cycle-onboarding-stage-2.md`](./mid-cycle-onboarding-stage-2.md)).
Uses the **draft** Minimum Data Set (Stage 1 §1.10); Tier 1 is to be finalized
later and nothing here depends on the exact list.
**Date:** 2026-10-17
**Scope:** capturing the provider's SSN and their CAQH ProView and PECOS
credentials during onboarding. Buy vs build across three approaches (3.1),
preceded by the question the buy-vs-build matrix cannot answer on its own:
how much of this must be captured at all (3.0).

Carried in from Stages 1 and 2:

- Sensitive items are never asked at the gateway's first session. They are a
  separate, later step inside the same verified gateway session, reachable
  only after Minted has admitted the row (Stage 1 §1.4, §1.10).
- The owner of each sensitive field is the provider. A missing one shows as a
  gap pill for the coordinator and a nudge for the provider, never as an
  admission blocker on its own (Stage 2 §2.3).
- Every reveal, release, store, and intake is one `audit_log` row with the
  real actor and, for reveals, a typed justification.

---

## 0. What already exists (the vault inventory)

The question is not "should we build a vault." One exists, and it is the
reference posture for everything below.

| Piece | What it is today |
| --- | --- |
| `provider_ssn_vault` (E4.4) | One row per provider: `ssn_ciphertext bytea`, `algo`, `key_version`, actor stamps. RLS enabled, `REVOKE ALL` from anon and authenticated, **no client SELECT grant and no service-role grant**. A direct PostgREST read returns nothing and could not decrypt anyway. |
| Encryption | pgcrypto `pgp_sym_encrypt/decrypt` inside Postgres, via private `_ssn_*` helpers with zero client EXECUTE grants. |
| Master key | **Supabase Vault** secret `ssn_vault_key` (migration `20260718020000`), read only by the SECURITY DEFINER owner; falls back to a GUC for local dev; fails closed with no key. Never returned to any client. `algo` / `key_version` keep the schema ready for app-layer envelope encryption with an external KMS ("Option B" in the E4.4 doc) without a data migration. |
| Write paths | `store_ssn(provider, ssn)` — authenticated writer, encrypt-on-save, mask + audit. `submit_ssn_intake(token, ssn)` — anon, via the single-use `/ssn-intake/$token` link; echoes only the mask. |
| Read paths | `reveal_ssn(provider, justification)` — **admin-only**, decrypt once, immutable audit READ with the justification; the UI (`SsnRevealDialog`) shows the value for a fixed window then drops it from memory. `release_ssn_for_fill(provider, org, case)` — **service-role only**, the `/api/providers/:id/ssn-release?caseId=` route for the Chrome extension's fill, re-checks the active fill context, the handler writes the audit row with the real actor. |
| What ordinary reads see | `providers.ssn_last4`, masked `***--1234`. Full SSN never enters a list payload, the query cache, or a log. |
| Authorization analysis | `docs/ops/p01-vault-authorization.md` (P01). |

Two things follow. The SSN half of Stage 3 is **already solved** at the storage
layer; what is missing is only the *moment of capture* inside the new gateway
session. And any option for CAQH / PECOS credentials is measured against this
posture, because a weaker one would be a regression next to the SSN.

---

## 3.0 Reduce what must be captured (the step before buy vs build)

The SSN and the two credentials are different kinds of secret, and the
difference decides most of the matrix.

| | Full SSN | CAQH ProView login | PECOS (CMS Identity & Access) login |
| --- | --- | --- | --- |
| **Who consumes it** | A form field. Filled into payer applications by the extension (`release_ssn_for_fill`) or typed from a reveal. | A human: the coordinator signs in to ProView to update the profile and attest. | A human: the coordinator signs in to PECOS to submit or update enrollment. |
| **Can the need be removed?** | No. Payers require it. | **Largely.** CAQH's Practice Manager Module and the "authorized organization" model let a practice or CVO view and manage a provider's profile without the provider's password. | **Yes, by design.** CMS I&A supports **surrogates**: the provider (or the practice's authorized official) approves staff as a surrogate, who then act in PECOS under their own login. CMS's I&A terms prohibit sharing credentials, and I&A passwords expire on a short fixed cadence (60 days), so a stored PECOS password is both a policy problem and a rotting asset. |
| **Rotation** | Never. | Occasional, provider-driven. | Forced every 60 days. |
| **Panel position** | Capture once, vault, release only into a fill. Exists. | **Surrogacy first.** Capture a credential only when the practice cannot or will not set up organizational access, and record *why* on the row. | **Surrogacy, not capture.** The intake step guides the provider through adding Minted's coordinator as a surrogate in I&A. A PECOS password is captured only as a documented exception, with the expiry cadence driving the rotation loop. |

What this changes: the **volume of credentials to store falls to the
exception set**, the liability of holding portal passwords is bounded, and the
"rotation UX" column of the matrix is mostly about PECOS exceptions. It also
means the onboarding step must be able to capture a **connection** (a surrogate
request confirmed, an authorized-org grant made) as a first-class outcome, not
only a secret. That is a status, derived from a dated note on the row, not a
new subsystem.

---

## 3.1 Buy vs build matrix

### The three approaches

1. **Embedded tokenization vault (buy, seamless UX).** A drop-in iframe or API
   vault (VGS, Skyflow, Basis Theory). The sensitive field renders inside the
   vendor's iframe on our existing form; the value goes to the vendor; we store
   a token; reveal or fill calls the vendor with our key.
2. **Out-of-band secure sharing (buy, ultra-low build).** The provider is asked
   to share the secret through a standalone tool: a 1Password or Bitwarden
   "request an item" / secure Send, or an enterprise one-time-secret link; the
   coordinator reads it from the password manager and the panel stores only a
   pointer or nothing.
3. **Native vault extension (build).** Extend the existing E4.4 vault pattern
   to a `provider_portal_credentials` table with the same posture; capture in
   the gateway's post-admission step; reveal with justification; rotation via
   the same gateway.

### The matrix

| Dimension | 1. Embedded tokenization vault | 2. Out-of-band secure sharing | 3. Native vault extension |
| --- | --- | --- | --- |
| **Implementation speed** | 3–6 weeks: vendor onboarding and BAA, iframe integration in the gateway form, token columns, reveal and fill paths rewritten to call the vendor, gate assertions. Two environments to provision. | Days. A copy block in the intake step ("share your CAQH login with us via this 1Password request") and a dated note on the row. No code path touches the secret. | 1–2 weeks. The E4.4 migration copied for a second table, three RPCs (`store_portal_credential`, `reveal_portal_credential`, `submit_credential_intake`), one gateway screen, gate assertions. The template is a migration that already runs on hosted. |
| **Engineering maintenance** | Medium. A vendor SDK and iframe in the critical path of a form that must work on a clinician's phone; vendor outages become our outages; two reveal paths (SSN native, credentials vendor) unless the SSN is migrated too, which is a data migration of a working vault. | Low in code, **high in operations**: a human copies secrets between systems; linking a 1Password item to a provider row is manual; offboarding a coordinator means auditing a shared vault, not revoking a role. | Low. One pattern, already maintained; the same key, the same audit shape, the same reveal dialog. Key rotation and the Option-B KMS upgrade apply to both tables at once. |
| **Compliance / liability burden** | Lowest for data-at-rest: the secret never lands in our database, which is the strongest story in a SOC 2 or customer security review. Still our liability at reveal time (the plaintext is in the coordinator's browser either way). HIPAA BAAs available from the main vendors. | **Ambiguous.** The secret lives in a third-party password manager under Minted's account; audit trail is the vendor's, not the panel's; per-provider access scoping is by folder discipline. Hard to answer "who saw this provider's PECOS password and when." | Ours, and already accepted for the SSN. Encrypted at rest with a server-held key no client can read; per-reveal audit with justification; no service-role grant. Weakness: a single symmetric key in Supabase Vault rather than an external KMS; the schema is ready for that upgrade when a customer or auditor requires it. |
| **Credential rotation / update UX** (provider changes their CAQH password later) | Provider re-enters in the same iframe field via the gateway; vendor overwrites the token. Good. Coordinator-initiated "please update" is a nudge to the gateway. | Provider must be re-asked out of band and re-share; a second manual copy. Nothing tells the panel it happened unless someone writes the note. Poor, and PECOS's 60-day cadence makes it recurring. | Provider enters the gateway (email + code, Stage 1), opens "Update a login," types the new value; `rotated_at` updates; the coordinator's stale-credential pill clears. Coordinator-initiated "request update" is the Stage 2 nudge with a different template. Same loop as everything else. |
| **Cost** | Enterprise pricing. VGS and Skyflow are quote-based with annual minimums typically in the five figures; Basis Theory has usage pricing that fits a small team but still adds a vendor review. Plus engineering time above. | Roughly $8–10 per Minted seat per month for a business password manager; near zero otherwise. The hidden cost is coordinator time per secret, forever. | No marginal spend. Supabase Vault is already in use. |
| **Clinician trust perception** | The field looks native; the clinician cannot tell a vendor is involved, which means it adds no trust *signal*. The surrounding gateway (practice name, code verification, what-we-never-ask copy) carries the trust either way. | Mixed. 1Password is recognisable to some clinicians and alien to others; a "secure link" from a tool they have never heard of reads like phishing, which is exactly the anxiety Stage 1 set out to remove. Breaks the single-door principle: a second URL, a second sender. | Same door, same sender, same screen style the clinician already verified with a code. "Encrypted, never shown back, released only into your payer application" is a sentence the panel already shows for the SSN. Strongest continuity. |

### Where each one wins

- **Option 1 wins** if a customer's security review demands that no secret of
  any kind rests in Minted's database, or if the team decides to migrate the
  SSN as well and wants one vendor-backed story. Neither is true today.
- **Option 2 wins today, as the interim**, for any practice onboarding before
  the native step ships: it costs nothing and keeps secrets out of email.
- **Option 3 wins on every dimension that is about the product**: speed,
  maintenance, rotation, trust, and cost, because the hard part already runs
  in production.

---

## 3.2 Recommendation

**Build the native extension (Option 3), surrogacy-first, with Option 2 as the
zero-build interim, and keep Option 1 as a documented trigger rather than a
plan.**

Concretely, for an agile B2B healthcare SaaS team:

1. **Policy first (3.0).** PECOS access is obtained by surrogacy in I&A, guided
   from the intake step; CAQH access by the practice's organizational
   authorization where available. A stored portal password is an exception
   with a recorded reason. This removes most of the liability before any code.
2. **Extend the vault, do not fork it.** `provider_portal_credentials`
   (`provider_id`, `org_id`, `portal` ∈ {caqh, pecos, other}, `username` (not
   secret, plain), `secret_ciphertext bytea`, `algo`, `key_version`,
   `rotated_at`, `last_verified_at`, `exception_reason`, actor stamps), same
   RLS and grant posture as `provider_ssn_vault`, same `_ssn_vault_key()` (or
   a sibling helper reading the same Vault secret). Three RPCs mirroring the
   SSN ones. Reveal is **admin or specialist with justification**, copy to
   clipboard with auto-clear and a 30-second window, one audit row per reveal.
   The extension **never** fills a password in v1; the clipboard path is the
   release path.
3. **Capture inside the gateway, after admission.** The Stage 1 gateway gains a
   "Secure items" screen reachable only when the row is admitted: the SSN
   field (writes through `submit_ssn_intake`'s logic, now session-bound rather
   than link-bound), the PECOS surrogacy walkthrough with a "done" confirmation
   that writes a dated note, and the CAQH connection or credential, with the
   exception reason when a credential is taken. The provider's "what we never
   ask on the first screen" promise holds: this is the second screen, after
   a human admitted them.
4. **Rotation is the same loop.** `rotated_at` plus a per-portal cadence (PECOS
   60 days, CAQH on change) derives a stale pill for the coordinator and a
   nudge for the provider through the Stage 2 ladder, with the gateway as the
   update path. No new scheduler, no new template system.
5. **Interim, today:** practices onboarding before the step ships share
   credentials through a 1Password item request owned by Minted, and the
   coordinator records "credential held in 1Password, item ID" as a provider
   note. No secret in email, no new code.
6. **Revisit Option 1 only on a trigger:** a signed customer whose security
   questionnaire fails on "secrets at rest in the application database," or
   an auditor requiring external KMS custody. Even then, the first move is the
   Option-B envelope encryption the schema already anticipates, not a vendor
   iframe.

### What this does not build

- No second vault technology, no vendor SDK in the gateway.
- No automatic portal login or password fill by the extension.
- No new scheduler, notification system, or credential-management UI beyond
  one gateway screen, one reveal dialog (reused), and one stale pill.
- No change to the SSN vault, its RPCs, or the `/api` fill contract.

### Open for the PM

1. Confirm the surrogacy-first policy for PECOS and the authorized-org
   preference for CAQH, and that a stored credential requires a recorded
   exception reason.
2. Confirm reveal scope for portal credentials: admin + specialist (the
   coordinators who use them), versus admin-only like the SSN.
3. Confirm the interim: 1Password item requests owned by Minted until the
   gateway step ships.
4. Decide whether the SSN must be vaulted before admission or before the first
   payer submission (Stage 1 §1.10 open question); this fixes where the
   "Secure items" screen sits in the provider's sequence.
