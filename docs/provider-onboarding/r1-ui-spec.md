# Provider onboarding R1: UI pass plan and spec

Status: v4, Oct 25, 2026 (grill-me round folded in: decisions 17–21). Revised after a Fable review and a zen (gpt-5.5) review. The six UI-blocking questions are answered (decisions 9–16). Built so far: §10 step 1 (types, fixtures, pure derivations and their tests) and, through `slice-1-invite-to-form.md`, the provider identify → code → consent → form screens as the real `/intake/$token` route. The `/dev/provider-onboarding` preview shell (decision 18) is not built; the fixtures' only consumer today is `src/lib/providerOnboarding.test.ts`.

## 1. Goal

Build every R1 screen of provider onboarding as real routes and components, running on mock data behind a feature flag:

- the practice invites a hire and sees where each hire stands;
- the provider walks email → code → consent → form → documents → thank you;
- Minted's coordinator sees the roster flag and the Onboarding card.

The PM reviews the flow in a browser before any schema, RPC or email backend is built.

**Why UI first.** The canvas changes the written spec (a consent screen, a documents step). Several backend decisions are still open (§9). And the onboarding-r1 branch shows what happens when the backend is built before the flow is settled.

**What mock data hides.** Two real constraints won't show up while the screens run on fixtures. The backend plan must handle both (§11):

- practice users can't read the `providers` table;
- the provider has no Supabase session.

## 2. Sources and precedence

| Rank | Source                                           | Location                                                                                                     |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 1    | Onboarding Flow Mocks canvas, Oct 19 (15 boards) | https://claude.ai/artifact/EfbtrQtFyov9orpnpWrqBW · extraction: `docs/provider-onboarding/canvas-screens.md` |
| 2    | Engineering Handoff (Requirements)               | `~/Downloads/Minted Panel Requirements.md`                                                                   |
| 3    | Experience Overview, Mocks Handoff, Build Status | `~/Downloads/` (same names)                                                                                  |
| 4    | Repo rules                                       | `AGENTS.md`, `CLAUDE.md`                                                                                     |

When the canvas and the Requirements disagree, the canvas wins (decided Oct 25). The canvas belongs to another organization, so it is read-only reference.

## 3. Decisions so far

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                        | Source                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | The only entry point is the practice's **Invite** button. Roster upload (the 6a upload card, R1.8–R1.9) is deferred                                                                                                                                                                                                                                                             | memory `provider-onboarding-entry-point`, Oct 22; re-confirmed Oct 25 |
| 2   | Provider order: email → identify → code → consent → form → documents → thank you                                                                                                                                                                                                                                                                                                | canvas readme note; `stage1` note                                     |
| 3   | Consent is a typed name plus a date, signed before the form. It replaces R1.24's checkbox                                                                                                                                                                                                                                                                                       | canvas readme note; `Consent.dc.html`                                 |
| 4   | Consent text is per organization and versioned, with a practice-name merge field. How each practice's text gets entered is **open** (Q1)                                                                                                                                                                                                                                        | `Consent.dc.html` HTML comment                                        |
| 5   | Whether a signed PDF copy is produced is **open** (Q2)                                                                                                                                                                                                                                                                                                                          | `Consent.dc.html` comment; 6b Activity "copy in Documents"            |
| 6   | The documents step comes after the form, and Submit lives there. Required: a CV and one license copy per state on the form. Optional: diploma, board certification, own liability insurance, something else                                                                                                                                                                     | canvas readme; `Documents.dc.html`                                    |
| 7   | The liability-insurance upload asks for an expiration date, because kind `coi` requires one                                                                                                                                                                                                                                                                                     | `src/lib/documents.ts` `coi.expirationRequired`                       |
| 8   | Uploads are mocked in the UI pass                                                                                                                                                                                                                                                                                                                                               | Oct 25 answer                                                         |
| 9   | The practice home is screen 0 (New hires), with screen 1's Invite modal. Screen 1's counters page is not built. Screen 0 is R2.8 and "Needs you" is R2.3 in the Requirements (R1 has only R1.4a's "simple list… stage only"). The UI pass builds the full screen 0 on mock data. Whether R1 ships all of it or a trimmed list is decided with the PM at the backend plan (Q15)  | Oct 25 answers; `OwnerView.dc.html`; Requirements §4.1, §5            |
| 10  | Specialty is a searchable picker over the 32 labeled codes in `src/lib/providerTaxonomy.ts`, the list the staff form uses. No default: the field starts empty and is required. This replaces the canvas's "225100000X · default for PT", because the invite carries no discipline (Q11)                                                                                         | Oct 25 answer; `Form.dc.html`; repo                                   |
| 11  | "I need help" and "I was told I don't need to do this" land on one confirmation screen in the provider shell: "We've let <practice> know. Your practice administrator will reach out." From inside the flow it returns to the step she was on; from an email it ends there. No free-text box (Q9)                                                                               | Oct 25 answer                                                         |
| 12  | The email help links carry an opaque invite token, so one tap records the request with no code. The confirmation page shows nothing about her, so rule 4 holds. Token design stays in Q4 (Q9b)                                                                                                                                                                                  | Oct 25 answer                                                         |
| 13  | Resend shows on every row in Invited or Started, and never from Submitted onward. Marcus's missing button on the canvas is treated as a drawing gap (Q12)                                                                                                                                                                                                                       | Oct 25 answer; `OwnerView.dc.html`                                    |
| 14  | After a resend, the button is disabled for 10 minutes and shows "Sent · resend in 10 min" (Q12b)                                                                                                                                                                                                                                                                                | Oct 25 answer                                                         |
| 15  | "Mark contacted" is the label on screens 0, 1 and 6b. It replaces "I've contacted her" and "Contacted" (Q13)                                                                                                                                                                                                                                                                    | Oct 25 answer                                                         |
| 16  | Intake uploads are capped at 10 MB (`INTAKE_MAX_BYTES`), as the canvas copy says. The vault's 25 MiB `DOCUMENT_MAX_BYTES` stays for staff uploads. The over-cap message suggests one photo per page (Q14)                                                                                                                                                                       | Oct 25 answer; `Documents.dc.html`; `src/lib/documents.ts:329`        |
| 17  | Screens first on sample data, then the real sending (Oct 25). The first build sends nothing                                                                                                                                                                                                                                                                                     | Oct 25 answer                                                         |
| 18  | The screens are reviewed on one preview page, `/dev/provider-onboarding`, gated like `/dev/global-search` (`import.meta.env.DEV \|\| VITE_DEV_PROVIDER_ONBOARDING === "1"`). A switcher picks Practice, Provider or Minted coordinator. No login, no real data. The real routes in §4 are wired when the real sending is built, from the same components                        | Oct 25 answer; `src/routes/dev.global-search.tsx`                     |
| 19  | Minted creates every practice user's login (no self-signup). A Minted admin can also open a practice's New hires view and use the same buttons; the audit log records the Minted admin as the actor. The staff app gets no second Invite button. The preview shows this as a "Viewing as: practice owner / Minted admin (assisting)" toggle with a banner in the assisting view | Oct 25 answer; R1.4; canvas 6a note                                   |
| 20  | Email links may carry an opaque **invite** token (`?i=`), which only prefills the email and records help taps. The **session** granted after the code never goes in the URL, `sessionStorage` or `localStorage`                                                                                                                                                                 | Oct 25 answer; rule 4                                                 |
| 21  | Save, finish later in the preview keeps the draft in memory for the visit, with a "Leave and come back" control that returns to identify → code and resumes it. A reload resets the preview. The real build saves on the server                                                                                                                                                 | grill-me default                                                      |

## 4. Screens in this pass

Screens use the canvas numbering. The audience decides the shell.

| #      | Screen                                                                                | Audience / shell                      | Route (proposed)                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 + 1  | New hires home and Invite modal                                                       | Practice user, client context (E6.12) | `/new-hires`                                                                | Summary line, State filter, Needs you, a five-step tracker per hire, Resend (decisions 13–14), Mark contacted (decision 15), and "+ Invite", which opens the modal (first name, last name, email, group, optional NPI and start date). Footer "N earlier hires… See their payer status →" links to `/reporting/enrollment-explorer`, already allowed for clients. "Add start date" link |
| 2      | Invitation email                                                                      | Provider's inbox                      | `src/server/email/templates.ts` key `provider_invitation`                   | Placeholder reassurance line. Depends on the SendGrid branch merging                                                                                                                                                                                                                                                                                                                    |
| 3 → 5c | Identify, code, check-your-email or invalid link, consent, form, documents, thank you | Public, chromeless                    | **One route** `/intake/$practiceKey`, with the step held in component state | One route avoids the hard-reload problem: with the session in memory, a reload or deep link to a sub-route would arrive with no session. Sub-routes come with the real session design. Step details below                                                                                                                                                                               |
| 6a     | Providers roster                                                                      | Minted staff app                      | `/providers` (existing)                                                     | Add an "Onboarding N" toggle beside "Has gaps", and an "Onboarding not complete" pill rendered beside the gap pills. It is not a new `ProviderGap` section, because `ProviderGap.section` is a closed union (`src/lib/providerGaps.ts:23`). No upload card (decision 1)                                                                                                                 |
| 6b     | Provider record                                                                       | Minted staff app                      | `/providers/$id` (existing)                                                 | Details below                                                                                                                                                                                                                                                                                                                                                                           |

**Steps inside `/intake/$practiceKey`:**

- **3 Identify.** The email is prefilled only if the link identifies the invite (Q4).
- **4 Code.** One real input behind six boxes, with `autocomplete=one-time-code`. It continues automatically when all six digits are in, and shows a resend countdown.
- **4b Check your email / invalid link.** The copy is identical whether or not the address is on file. Expired, invalid and already-used links all get the same failure copy. Canvas fix: State B shows the email field its copy refers to.
- **5 Consent.** The typed full name is required. The date is server-set and read-only. The step is skipped when the provider has already signed the current version.
- **5a Form.** Sections with progress chips (not a wizard): Identity, Contact, State licenses (+ Add), Logins. Prefilled fields show "From <source> · <date>". The SSN and passwords are never echoed back.
- **5b Documents.** One row per required slot (CV, plus one per license state), then the optional rows. Accepts PDF, JPG or PNG up to 10 MB (decision 16). The liability row gets an expiration date.
- **5c Thank you.** An add-sender card with a placeholder address. The confirmation email template is `intake_submitted`.

**6b Provider record, in detail:**

- **Onboarding section.** It comes first while the provider is onboarding and shows the stage tracker, Waiting on, Invited (date and email), Record, and Reminders sent, plus the Verification block and Admit & assign. "Record" reads "Confirmed · from a practice invite", because R1.6 makes a practice invite confirmed. The canvas's "Pending verification · roster upload" applies only to roster uploads, which are deferred.
- **Collapsed state.** After hand-off the section collapses to one line of history (`RecordOnboarding.dc.html` comment).
- **Readiness.** Readiness is a card inside the Cases tab (`src/routes/providers.$id.index.tsx`), not a tab. It is hidden while she's onboarding.
- **Activity.** It uses the existing notes surface.
- **"Test…" on a login check.** It opens a typed-reason dialog (R1.26). In the mock, it reveals nothing and marks the check confirmed.

`/onboarding/*` is not used. It is the existing staff org-intake wizard (`src/routes/onboarding.index.tsx`, `onboarding.wizard.tsx`). New files use a `providerOnboarding*` or `intake*` prefix so they don't collide with `onboardingProgress.ts` or `useOnboardingWizard.ts`.

**Not in this pass:** 7a (Reporting card), 7b (Provider Onboarding report) and 8 (reminder email). They are Release 2 on the spec, though drawn on the canvas. They come after R1 review unless the PM pulls them in (Q7).

## 5. Data shapes

`src/types/providerOnboarding.ts` is additive. Both the mock data and the later backend satisfy it, so swapping the backend changes only the services.

```ts
type OnboardingStage = "invited" | "started" | "submitted" | "ready" | "in_credentialing";
type WaitingOn = "provider" | "practice" | "minted";

// Milestones are events (rule 8: stages are derived, never stored).
type OnboardingEventType =
  | "invited"
  | "invitation_resent"
  | "reminder_sent"
  | "signed_in"
  | "consent_signed"
  | "section_saved"
  | "submitted"
  | "help_requested"
  | "told_not_needed"
  | "practice_contacted"
  | "admitted"
  | "first_case_created";
interface OnboardingEvent {
  type: OnboardingEventType;
  at: string; /* ISO */
}

interface OnboardingHire {
  // one row on screen 0; header data on 6b
  providerId: string;
  displayName: string; // "Anita Rao, PT"
  invitedEmail: string;
  groupName: string;
  locationName: string | null; // assigned at Admit & assign
  source: "practice_invite"; // roster_upload arrives with decision 1's follow-up
  states: string[];
  startDate: string | null; // practice-entered only
  events: OnboardingEvent[];
}

// source null = not yet provided or confirmed; counts toward progress only when non-null
interface FieldValue<T> {
  value: T | null;
  source: { label: string; asOf: string } | null;
}

interface IntakeDraft {
  // 5a; secrets are write-only flags
  identity: {
    firstName: FieldValue<string>;
    lastName: FieldValue<string>;
    npi: FieldValue<string>;
    taxonomyCode: FieldValue<string>;
    dateOfBirth: FieldValue<string>;
    caqhId: FieldValue<string>;
    ssnOnFile: boolean;
  };
  contact: { email: string; mobile: FieldValue<string>; homeAddress: FieldValue<string> };
  licenses: {
    state: FieldValue<string>;
    number: FieldValue<string>;
    expiresOn: FieldValue<string>;
  }[];
  logins: { caqhOnFile: boolean; pecosOnFile: boolean };
}

interface DocumentSlot {
  key: string;
  kind: DocumentKind;
  label: string;
  required: boolean;
  licenseState?: string;
  needsExpiration: boolean; // coi only; a license copy takes its date from the form
  file: { name: string; sizeBytes: number; expiresOn: string | null } | null;
}

interface VerificationCheck {
  // 6b; check-as-data (R1.29)
  key: string;
  label: string;
  status: "confirmed" | "pending";
  method: "auto" | "person";
  confirmedBy: string | null; // person checks only; auto rows render "Auto"
  action: "test_login" | "confirm" | null;
}
```

**Fixture rules.** All fixtures use one data set with stable IDs, and every count on every screen is computed from it, never typed in by hand. The canvas's own counts don't add up across screens 0, 1, 6a and 7b, so the fixtures don't try to match them. Each fixture provider is a canvas name with no real PHI.

## 6. Pure logic (`src/lib/providerOnboarding.ts`, tested first)

| Function                       | Rule                                                                                                                                                                                          | Source               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `deriveStage(events)`          | The highest-ranked milestone present, regardless of timestamps. Rank: first_case_created > admitted > submitted > signed_in > invited                                                         | rule 8; 6b tracker   |
| `deriveWaitingOn(events)`      | Invited or started → provider, unless a help hatch is open (`help_requested` or `told_not_needed` after the last `practice_contacted`), in which case → practice. Submitted or ready → minted | screen 0 rows; R2.3  |
| `needsPractice(hire)`          | A help hatch is open, as above                                                                                                                                                                | screen 0 "Needs you" |
| `canResend(hire, now)`         | Stage is invited or started, and the last `invited` / `invitation_resent` event is at least 10 minutes before `now`                                                                           | decisions 13–14      |
| `sectionProgress(draft)`       | "Identity · 3 of 7": a field counts when `source !== null`. The Specialty default and the prefilled "NC" don't count until confirmed                                                          | 5a chips             |
| `canContinue(draft)`           | Every D2 field is present and at least one license exists                                                                                                                                     | 5a; D2               |
| `requiredDocumentSlots(draft)` | A CV, plus one license slot per distinct, non-blank license state                                                                                                                             | 5b                   |
| `validateUpload(file)`         | Type is PDF, JPG or PNG, and size is at most the cap                                                                                                                                          | 5b                   |
| `verificationSummary(checks)`  | "10 of 13 confirmed · 3 pending"                                                                                                                                                              | 6b                   |

**Tests, written before code:**

- stage with out-of-order timestamps;
- `admitted` without `submitted`;
- resend doesn't change the stage;
- help then contacted clears Needs you, and a second help request after contacted brings it back;
- `told_not_needed` sets Needs you;
- adding a license adds a slot, and removing it removes the slot and its upload;
- duplicate license states give one slot;
- a blank-state row gives no slot;
- zero licenses make `canContinue` false;
- upload type and size are enforced (10 MB cap);
- Resend: hidden from Submitted onward, disabled within 10 minutes of a send, enabled again at exactly 10 minutes;
- the summary counts are correct.

## 7. Architecture

**Layering doesn't change.** Routes → hooks (`src/hooks/useProviderOnboarding.ts`, `useIntake.ts`, keys in `queryKeys`) → services (`src/services/providerOnboarding.ts`, `intake.ts`).

- In this pass, the services return fixtures from `src/services/providerOnboardingFixtures.ts`.
- No Supabase call, no migration, no `/api` route, so no isolation-gate change.

**The intake service skips `requireActiveOrg()`.** The provider has no session and no org. That makes it the third service to skip it, after `globalProviderSearch.ts` and `ssnVault.ts`. Its query keys are not org-scoped. The CLAUDE.md "Known warts" entry gets a line.

**Preview first (decision 18).** In the first build, nothing below mounts on the real routes. `/dev/provider-onboarding` renders the screen components with fixtures; the route, `__root.tsx` and `/providers` wiring described here happens with the real sending.

**Flag (real routes, later).**

- `VITE_ENABLE_PROVIDER_ONBOARDING === "true"` mounts the new routes, the 6a toggle and the 6b section. The mechanism follows `VITE_ENABLE_EXACT_WORK_V2`.
- The flag stays unset in `vercel.json`'s single env block, which means off everywhere deployed.
- It must stay off in production until the placeholder copy (§8) is final.

**Practice route `/new-hires`:**

- **Client fence.** Add the route to the client-context fence in `__root.tsx` (today `isRestrictedReportingPath` allows only `/reporting` and `/reporting/enrollment-explorer`). Generalize `clientReportOutlet` to `clientOutlet`, and pass in the header title, because `ClientReportSurface` hard-codes "Reporting Center" (`AccessContextBoundary.tsx:301-305`).
- **Staff users.** A staff user on `/new-hires` gets not-found, checked at render time. A `beforeLoad` guard won't work, because the store is empty on a hard load (CLAUDE.md known wart).
- **Roles.** The practice role (owner, coordinator or billing) is new, since `EnrollmentClientOrg` has no role (`src/services/clientAccess.ts:23-27`). The fixtures carry a role so the "billing sees no Invite" rule (R1.2) can be shown. The real source is a backend decision (Q3).

**Provider shell.** This is a new chromeless component that leads with the practice name, then "Secure intake by Minted Panel", designed for 390px first.

- The `/ssn-intake` `Shell` can't be reused. It isn't exported, and it leads with "Minted Panel".
- The onboarding-r1 branch's `components/onboarding/Shell.tsx` and `Lockdown.tsx` may be cherry-picked as a starting point after review.

**Provider session in the mock.** It lives only in component memory. It never goes in the URL, `sessionStorage` or `localStorage`. The onboarding-r1 code used `sessionStorage` and `?session=` (`src/routes/onboarding.code.tsx:55-60` on that branch).

**Emails.** The invitation, confirmation and help-received templates join the closed registry in `src/server/email/templates.ts` (this branch stacks on the SendGrid branch). The browser can't import them (Vite blocks `**/server/**`), so the preview page shows each email as a static frame, and the real HTML is checked by sending it with the CLI (`--template`, sandbox by default).

**Components:**

- Stock shadcn styled with `var(--mp-*)` tokens.
- One stage-tracker component, shared by screens 0 and 6b ("same component as the owner view").
- The taxonomy picker reuses the searchable picker pattern (`ControlOptionPicker`).
- Anything unspecced is logged in `DESIGN-DEBT.md`.

## 8. Placeholder copy

AGENTS.md forbids shipping placeholder text to the UI. Three pieces of canvas copy are placeholders until Q3: the reassurance line (2), the security line (5a) and the sending address (5c).

- In this pass they render with the canvas's "Placeholder · copy pending" tag.
- They are logged in `DESIGN-DEBT.md`.
- The flag stays off in production until they are replaced.

## 9. Open questions

**Answered Oct 25 (no longer blocking the UI pass):** Q9 → decisions 11–12; Q11 → decision 10; Q12 → decisions 13–14; Q13 → decision 15; Q14 → decision 16; Q15 → decision 9.

**These don't block the UI pass. They block the backend plan:**

| #   | Question                                                                                                                                                                                               | Source                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Q1  | Per-org consent text: who enters it (a Minted admin screen, a SQL seed, or the practice), and where is it stored? Nothing exists today                                                                 | `Consent.dc.html` comment                        |
| Q2  | Is a signed PDF of the consent filed in the vault, or is the stored record itself the signed copy?                                                                                                     | `Consent.dc.html`; 6b Activity                   |
| Q3  | The practice role (owner, coordinator or billing) is new. Where does it live?                                                                                                                          | R1.2; `private.client_access` has no role        |
| Q4  | Screen 3 prefills the email, so the link identifies the invite. Does an invite-bound link fit rule 4 (a forwarded email reveals nothing) and R1.15 (an opaque practice identifier)?                    | `Gateway.dc.html`; Requirements §3 rule 4, R1.15 |
| Q5  | Mobile: store it in `providers.phone`, or add a `mobile` column?                                                                                                                                       | 5a; repo                                         |
| Q6  | Home address is one text field on 5a, but the repo stores `home_street/city/state/zip`. Split the field?                                                                                               | 5a; `providers` columns                          |
| Q7  | Pull 7a, 7b and 8 into this pass?                                                                                                                                                                      | canvas row 2; Requirements §5                    |
| Q8  | Reply-to for provider emails: the inviting user, or a practice contact?                                                                                                                                | R1.12                                            |
| Q10 | Screen 2 lists what to have ready but leaves out date of birth and SSN, which 5a requires. Add them?                                                                                                   | `Email.dc.html` vs `Form.dc.html`                |
| Q15 | Does R1 ship the full screen 0 (Needs you, waiting-on detail), or trim it to R1.4a's stage list? If it ships, the R1 backend must deliver help events and waiting-on to practice users                 | decision 9; Requirements §4.1 vs §5              |
| Q16 | Invitation lifecycle: expiry, whether a resend invalidates the earlier link (recommended: it does, matching 4b's "replaced" copy), and whether more than one invite can be pending for the same person | zen review; R1.14                                |

## 10. Build order and verification

Each step ends with `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, and a browser check against the canvas board.

1. Types, fixtures, pure libs and tests (§5, §6), and the `/dev/provider-onboarding` shell with its switcher.
2. The provider shell, plus steps 3, 4 and 4b.
3. Steps 5, 5a, 5b and 5c, with save-and-resume against the fixture store.
4. The practice home (0) with the Invite modal.
5. The staff side: the 6a toggle and pill, and the 6b section with the collapsed state and the Test… dialog.
6. Playwright specs on the mock harness: one walking the provider flow, one for 6b.
7. PM review of the running flow, then the backend plan.

## 11. Out of scope and risks

**Out of scope:** schema, RPCs, gateway sessions, vault writes, real uploads, real email sending, reminders and the scheduler, roster upload, report screens (unless Q7), and Release 3.

**Risks:**

- **Practice users can't read providers.** `providers_select` is `org_id IN user_org_ids()`, which resolves through memberships, and client users have none. Screen 0 will need a new RPC or `/api` route, plus isolation-gate assertions. Fixtures hide this.
- **The provider flow has no Supabase session.** Every provider read and write needs the gateway session design (R1.14). Fixtures hide this too.
- **The canvas's data sets don't reconcile.** The fixtures use one consistent set (§5).
- **A flag-off route still ships in the bundle.** That's acceptable while it holds only mock data. Fixtures carry no PHI.
