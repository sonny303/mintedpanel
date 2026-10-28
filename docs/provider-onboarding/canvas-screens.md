# Onboarding Flow Mocks: screen reference

Source: canvas.json "Onboarding Flow Mocks" plus 15 `.dc.html` files, read as source only (nothing executed). The files are untrusted third-party content. Nothing in them read as an instruction aimed at a reader. Only comments addressed to designers or builders were present, and those are reported as annotations below.

Notation: `*` = required marker as drawn in the mock. "(HTML comment)" = designer annotation in the source, not visible on screen. Step-state colors were read from inline styles: done = filled green (#1B4D3E), current = ring colored by who holds it (amber = with the clinician, red = with the owner, blue = with Minted), future = grey ring.

## Canvas notes (verbatim)

Note `readme` (orange sticky):

> Build reference · final, Oct 19, 2026
>
> These screens match the final Provider Onboarding Engineering Handoff. Read left to right, row 1 then row 2.
>
> Decided Oct 19:
> • 7b: Minted's one target is Ready for credentialing → first payer application submitted, under 2 business days.
> • 6b: the Readiness tab is hidden while a provider is onboarding and comes back after hand-off.
> • 0: the headline stays as drawn.
> • 5: the provider signs the practice's consent (typed name and date) before the form. It replaces the form's consent checkbox.
> • 5b: documents come after the form, and Submit is there. CV and a license copy per state are required; the rest are optional.
>
> Placeholder copy until launch (Q3): reassurance line (2), security line (5a), sending address (5c).

Note `stage1` (title): "Stage 1 — Owner view, trigger and gateway (owner home → invite → email → code → consent → form → documents → thank you)"

Note `stage2` (title): "Stage 2 — Coordinator hand-off, report and reminders (roster flag, Onboarding card, Provider Onboarding report, reminder email)"

Note `note-5mxo8o` (title1): empty text.

Canvas title: "Onboarding Flow Mocks". Attachments: none. Design systems: none. Created 2026-10-16.

Order on canvas: 0, 1, 2, 3, 4, 4b, 5, 5a, 5b, 5c in row 1 (Stage 1). 6a, 6b, 7a, 7b, 8 in row 2 (Stage 2). Positions are not strictly a 5+5 layout. 6b sits at y=2950, below 6a.

Shared branding on provider-facing screens (3, 4, 4b, 5, 5a, 5b, 5c): shield-check mark in a green tile, "Shelby Sports Rehab" (org first), "Secure intake by Minted Panel" (Minted as operator). Chromeless, 390px wide. Screens 5, 5a, 5b add the right-aligned line "Signed in as anita.rao@…".

---

## 0. Owner: New hires (CEO view)

- Board: "0. Owner: New hires (CEO view)". File: OwnerView.dc.html. Desktop, 1280x860, page `<title>` "Owner view: New hires".
- Who sees it: Dana Shelby, practice owner/CEO at Shelby Sports Rehab. Her home screen.

Layout:

- Top bar (dark green): Minted logo, "Minted Panel", "Shelby Sports Rehab". Right: "Dana Shelby", "Sign out" button.
- A. Headline strip:
  - h1 "New hires" (small, grey).
  - Large headline "provider credentialing onboarding dashboard" (lowercase, as drawn; canvas note: "0: the headline stays as drawn").
  - Summary line: "**1 waiting on you** · 2 with the clinician · 2 with Minted".
  - Primary button "+ Invite".
- Filter: label "State", select with options "All states", "North Carolina (NC)", "South Carolina (SC)". (HTML comment: "State (narrows the counts, Needs you and every row)".)
- B. "Needs you" section (red dot heading). One card:
  - "Jisoo Kim, PT" with link "· add start date".
  - Body: "Jisoo asked for help on Oct 15 and hasn't finished her form. Call her, or resend the invitation."
  - Buttons: "Resend", "I've contacted her".
- C. "Every new hire" section:
  - Legend (colored rings): "with the clinician", "with you", "with Minted".
  - Table columns: Hire | five-step tracker (Invited, Started, Submitted, Ready for credentialing, In credentialing) | Waiting on | actions (no header).
  - Rows (name, sub-line, current step, waiting-on text, buttons):
    - Jisoo Kim, PT. Sub-line: link "add start date" · NC. Current step Started (red). Waiting on: "**You** · she asked for help Oct 15". Buttons "Resend", "Contacted".
    - Anita Rao, PT. "starts Nov 3 · NC". Current step Invited (amber). Waiting on: "**Anita** · invited, hasn't signed in yet". Buttons "Resend", "Contacted".
    - Marcus Bell, DPT. "starts Oct 27 · NC". Current step Started (amber). Waiting on: "**Marcus** · started, answers saved, not submitted". Button "Contacted".
    - Lena Ortiz, PTA. "starts Nov 10 · NC". Current step Submitted (blue). Waiting on: "**Minted** · submitted, awaiting review". No buttons.
    - Owen Park, PT. "starts Oct 20 · NC, SC". Current step Ready for credentialing (blue). Waiting on: "**Minted** · ready for credentialing, no payer applications yet". No buttons.
- D. Footer: "9 earlier hires are in credentialing. [See their payer status →]". (HTML comment: "no provider times or targets on this screen".)
- Empty states: none drawn.

Annotations: canvas decision "0: the headline stays as drawn."

---

## 1. Owner: Invite (dialog)

- Board: "1. Owner: Invite (dialog)". File: Main.dc.html. Desktop, 1280x800. Page `<title>` "Client context: Invite a provider".
- Who sees it: Dana Shelby, "Office Manager". The practice contact in a client-context view. Role label differs from screen 0 (see observations).

Layout:

- Top bar (HTML comment "Client-context top bar: no internal nav, one org, one audience"): logo, "Minted Panel", "Client view · Shelby Sports Rehab". Right: "Dana Shelby · Office Manager", "Sign out".
- Page header: h1 "Onboarding". Sub: "Your groups: Shelby Sports Rehab (Charlotte, Concord). Minted admits, assigns and credentials; you invite and follow up." Button "+ Invite".
- Five counters (label / number / caption):
  - Invited / 2 / waiting on the provider
  - Started / 1 / answers saved
  - Submitted / 1 / with Minted
  - Ready for credentialing / 3 / with Minted
  - In credentialing / 9 / see Enrollment Explorer
- Table (HTML comment: "client sees name, stage, who it's waiting on, reminders sent; no times, no inviter, no PHI"). Columns: Provider | Stage | Waiting on | Reminders sent | (actions).
  - Anita Rao, PT | Invited | Anita | — | "Resend", "Mark contacted"
  - Marcus Bell, DPT | Started | Marcus | 1 | "Mark contacted"
  - Lena Ortiz, PTA | Submitted | Minted | 1 | "Read only"
  - Owen Park, PT | Ready for credentialing | Minted | — | "Read only"
- Modal "Invite a provider" (HTML comment: "the client's one write"; shown over the page):
  - Heading "Invite a provider". Sub: "They get an email from you and verify with a code sent to that address."
  - Fields (no required markers shown): "First name" (prefilled "Anita"), "Last name" (prefilled "Rao"), "Email" (prefilled "anita.rao@example.test"), "Group" (select, one option "Shelby Sports Rehab").
  - Collapsible `<details>` "+ NPI and start date (optional)": "NPI" placeholder "10 digits"; "Start date" placeholder "MMM d, yyyy".
  - Footer note: "Hiring several at once? Send Minted your spreadsheet and we'll upload it."
  - Buttons "Cancel", "Send invite".

---

## 2. Invitation email

- Board: "2. Invitation email". File: Email.dc.html. Mobile mail client, 390x1130.
- Who sees it: Anita Rao (provider), arriving in her inbox. Sender "Shelby Sports Rehab via Minted Panel", 2:11 PM, "To: Anita Rao".

Layout:

- Mail chrome: back "Inbox", up/down arrows.
- Subject: "Welcome to Shelby Sports Rehab: your credentialing form".
- Body card: shield icon + "Shelby Sports Rehab".
  - "Hi Anita,"
  - "Welcome aboard. Before you can see patients under our payer contracts, we need your credentialing details. You can do it in one sitting, or save and finish later."
  - "Make sure you have these on hand before you start:"
    - Your NPI
    - Your state license number and expiration date
    - Your CAQH ID
    - Your CAQH ProView login (username and password)
    - Your PECOS login (username and password)
    - Your mobile number and home address
    - Your CV and a copy of your state license
  - Button "Get started" (links to Gateway, screen 3).
  - "We'll send a 6-digit code to this address after you tap the button."
  - PLACEHOLDER block, tagged "Placeholder · copy pending": "[NEW REASSURANCE LINE: to be written and approved with the email templates (D10, Q3)]". HTML comment: "Placeholder: the new reassurance line (D10, Q3). The old 'we never ask for your SSN or passwords' line is dropped."
  - Links: "I need help", "I was told I don't need to do this".
  - "Questions? Just reply to this email."
  - Sign-off "Thanks,<br>Shelby Sports Rehab".
- Footer: "Sent by Minted Panel on behalf of Shelby Sports Rehab" / "Shelby Sports Rehab · 410 Mint St, Charlotte, NC 28202" / link "Why am I receiving this?".
- Mail bottom toolbar icons only.

---

## 3. Gateway: identify

- Board: "3. Gateway: identify". File: Gateway.dc.html. 390x844.
- Who sees it: provider (Anita) after tapping "Get started". Public, chromeless. HTML comment: "Chromeless shell: shield mark + org first, Minted as operator".

Layout:

- Header: shield mark, "Shelby Sports Rehab", "Secure intake by Minted Panel".
- h1 "Confirm it's you". Body: "Your practice administrator invited you. We'll send a 6-digit code to the address below to open your form."
- Field: "Email", prefilled "anita.rao@example.test" (source label not shown; presumably from the invite). No required marker.
- Button "Send me a code".
- Helper: "Have your NPI, license, CAQH ID, and your CAQH and PECOS logins handy. You can save and finish later."

---

## 4. Gateway: code

- Board: "4. Gateway: code". File: Code.dc.html. 390x844.
- Who sees it: provider, after "Send me a code".

Layout:

- Same header as 3.
- h1 "Enter your code". Body: "We sent a 6-digit code to **anita.rao@example.test** [Change]" (Change links back to screen 3).
- Label "Code". Six boxes showing 4, 8, 1, 9, empty, empty. A single real input sits behind them (`inputmode=numeric`, `autocomplete=one-time-code`, aria-label "6-digit code"). HTML comment: "a single real input behind them in the build".
- "Continues automatically when all six digits are in."
- "Didn't get it? Check spam, or **resend in 0:42**".
- No submit button.

---

## 4b. Gateway: no code / invalid link

- Board: "4b. Gateway: no code / invalid link". File: GatewayError.dc.html. 390x1000.
- Who sees it: provider. Two states stacked on one board.

Layout:

- Same header as 3.
- State A, after "Send me a code". HTML comment: "Identical whether or not the email is on file (no enumeration)."
  - Mail icon, h1 "Check your email".
  - "If **anita.rao@example.test** has an invitation or is on Shelby's roster, a 6-digit code is on its way. It can take a minute."
  - "Didn't get a code?"
  - Link rows: "Send it again" (sub: "check spam first"); "Use a different email" (sub: "the one you were invited with").
  - "Still stuck? Ask your practice administrator to resend your invitation. We can't say here whether an address is on file."
- State B. HTML comment: "lockdown, reusing the existing capture / ssn-intake lockdown copy".
  - Clock icon. Heading "This invitation is no longer valid".
  - "It may have expired or been replaced. Ask your practice administrator at Shelby Sports Rehab for a new one, or enter your email above to continue with a fresh code."
  - Button/link "Enter my email".
- Note: "enter your email above" refers to a field that State B does not show.

---

## 5. Consent: provider signs before the form

- Board: "5. Consent: provider signs before the form". File: Consent.dc.html. 390x1040.
- Who sees it: provider after verifying the code.

Layout:

- Header (as 3, smaller) plus "Signed in as anita.rao@…".
- h1 "Your consent". Sub: "Please read and sign before you start your details."
- Consent text. HTML comment: "The practice's own consent text, stored per organization and versioned. Practice name is a merge field ('Fitness Physio' in their version). Shown once: a provider who has signed the current version goes straight to the form."
  - P1: "We at Shelby Sports Rehab recognize the challenges of maintaining your NPI, PECOS File, and CAQH File. As a benefit to our new employees and existing staff, we would like to extend our services to you to maintain your NPI and your PECOS and CAQH file. This includes the 120 day re-attestation by CAQH. We request that you provide us with your NPI and CAQH and PECOS login. Upon receipt of your User Name & Password we will only make necessary changes to reflect your current employment status."
  - P2: "By signing below, you will be giving your consent for us to provide any information needed to complete all insurance credentialing. Without this, we cannot enroll/update you in the necessary programs; thus denying us the ability to receive reimbursement for services you rendered to Medicare and Commercial patients. Your cooperation in providing this information is vital to all parties involved and is most appreciated."
- Signature block. HTML comment: "Signature: typed full name + date. Stored with the consent version, time and signer; a signed copy is filed on the provider record (Documents)."
  - "Type your full name to sign *" (required), placeholder "Anita Rao".
  - Date (read-only): "Oct 19, 2026".
- "A signed copy is kept on your file at Shelby Sports Rehab. See our [privacy policy]."
- "Questions about this? [I need help]. Your practice administrator will reach out."
- Button "Sign and continue" (to 5a).

Annotations: canvas decision "5: the provider signs the practice's consent (typed name and date) before the form. It replaces the form's consent checkbox."

---

## 5a. Pre-filled form: full profile

- Board: "5a. Pre-filled form: full profile". File: Form.dc.html. 390x1540.
- Who sees it: provider.

Layout:

- Header + "Signed in as anita.rao@…".
- Security line (HTML comment: "Page-level security line: the whole form is secure, not one section. Accurate to the handoff: every field travels encrypted; SSN and logins are also vaulted at entry and never shown back (rule 5). Final wording is part of Q3."). PLACEHOLDER copy per canvas ("security line (5a)"):
  - "**Secure form.** Everything you enter is encrypted as it's sent. Your SSN and logins are also locked in an encrypted vault and never shown back."
- h1 "Your credentialing details". "* required".
- Progress chips (HTML comment: "sections, not a wizard"): "Identity · 3 of 7", "Contact · 1 of 3", "Licenses · 0 of 1", "Logins · 0 of 2".
- Section Identity:
  - First name * = "Anita"; helper "From Shelby's roster · Aug 12".
  - Last name * = "Rao"; helper "From Shelby's roster · Aug 12".
  - NPI * = "1234567893"; helper "You entered this · today".
  - Specialty * (select), default "Physical Therapist". Options: Physical Therapist; PT · Orthopedic; PT · Sports; PT · Neurology; PT · Pediatrics. Helper "225100000X · default for PT". HTML comment: "Specialty is stored as the NPI taxonomy code. Defaults to the generic PT code; the provider can pick a PT specialty instead."
  - Date of birth * placeholder "MMM d, yyyy".
  - CAQH ID * placeholder "8 digits".
  - Social Security number * (password input), placeholder "•••-••-••••"; helper "Never shown back; only the last 4 digits appear afterward." HTML comment: "SSN: written straight to the vault; only the mask is echoed back".
- Section Contact:
  - Email (no asterisk) = "anita.rao@example.test"; helper "Verified today".
  - Mobile phone * placeholder "( ) -".
  - Home address * placeholder "Street, city, state, ZIP" (single text field).
- Section "State licenses" with "+ Add" button. One row:
  - State * = "NC" (text input, prefilled, no source label).
  - License number * (empty).
  - Expires * placeholder "MMM d, yyyy".
- Section Logins. HTML comment: "secure section, written to the encrypted login store; both logins are required to submit". Intro: "Never shown back. Used only to file and keep up your payer applications."
  - Fieldset "CAQH ProView": Username *, Password * (password input).
  - Fieldset "PECOS": User ID *, Password * (password input).
- "Stuck on a question? [I need help]. Your practice administrator will reach out." HTML comment: "Same 'I need help' action as the emails (R2.3): writes a provider note, pauses reminders, adds her to Needs you (practice) and Needs a human (Minted report)".
- Buttons: "Save, finish later", "Continue" (to 5b).

Annotations: R2.3, D10/Q3 reference, rule 5. Placeholder: security line.

---

## 5b. Documents: upload before submit

- Board: "5b. Documents: upload before submit". File: Documents.dc.html. 390x1060.
- Who sees it: provider, after the form.

Layout:

- Header + "Signed in as anita.rao@…". Back link "← Your details".
- h1 "Your documents". "* required · PDF, JPG or PNG, up to 10 MB each".
- HTML comment: "Each row is one existing provider_documents kind. Uploads land in the provider's Documents. The required set is configuration (D22): CV and one license copy per state on the form."
- Required rows:
  - "CV *": pill "Uploaded"; file "Anita_Rao_CV.pdf · 184 KB"; link "Remove".
  - "NC license copy *": helper "Uses the expiration date from your form"; button "Upload". HTML comment: "one row per license on the form".
- Heading "If you have them", optional rows, each with an "Upload" button:
  - "Diploma"
  - "Board certification"
  - "Your own liability insurance" (helper "Only if you carry a personal policy")
  - "Something else"
- "On a phone, Upload also lets you take a photo."
- "Stuck on a question? [I need help]. Your practice administrator will reach out."
- Buttons "Save, finish later", "Submit to Shelby" (to 5c).

Annotations: canvas decision "5b: documents come after the form, and Submit is there. CV and a license copy per state are required; the rest are optional." D22.

---

## 5c. Submitted: thank-you screen

- Board: "5c. Submitted: thank-you screen". File: ThankYou.dc.html. 390x844.
- Who sees it: provider, after Submit.

Layout:

- Header as 3.
- Check icon; h1 "Thank you for submitting!"
- "Please make sure you can receive our emails: add us to your address book so you get any follow-ups or clarifications insurers request."
- "Add this sender" card: "Shelby Sports Rehab via Minted Panel" and "[SENDING ADDRESS]" (PLACEHOLDER; canvas: "sending address (5c)").
- "We've also emailed this to **anita.rao@example.test**. You can close this page."
- HTML comment: "After Submit: thank-you plus the address-book ask; the same message goes out as the confirmation email (template 9). No status view in v1."

---

## 6a. Coordinator: existing Providers roster, Onboarding filter on

- Board: "6a. Coordinator: existing Providers roster, Onboarding filter on". File: Tracker.dc.html. Desktop 1280x900.
- Who sees it: Jordan Seed, Minted coordinator in the Minted Panel app (nav footer "Shelby Sports Rehab · Jordan Seed").

Layout:

- Left nav: Minted Panel logo; Home, Cases, Providers, Generation, Payer Setup, Reporting (links to 7a); footer "Shelby Sports Rehab · Jordan Seed".
- Header: h1 "Providers"; "Sorted A→Z by last name. Gap pills point at the exact record section to fix." Buttons "Export roster", "New Provider". HTML comment: "unchanged title, description, Export roster, New Provider. No coordinator invite: single hires come from the practice's Invite button".
- Toolbar (HTML comment: "existing controls plus one more toggle, in the same style as 'Has gaps'"): search placeholder "Search name or NPI"; select "All groups"; select "All states"; toggle "Has gaps" (off); toggle "Onboarding **6**" (on).
- Upload card. HTML comment: "the existing roster import, Minted-only in v1. Each row is marked Invite or Add as existing (D7); commit ends with Invite these N providers for the Invite rows":
  - "Upload provider CSV"
  - "One row per relationship. Mark each row Invite or Add as existing, then finish with Invite these N providers."
  - Button "Choose file".
- Table. Columns: Provider | NPI | Groups | Facilities | Licenses | CAQH attested | Cases | Gaps. A to Z by last name. HTML comment: "onboarding pill sits in the existing inline-pill slot". The gap link "Onboarding not complete" is the onboarding flag.
  - Bell, Marcus, DPT | 1245319599 | Shelby Sports Rehab | 1 | — | — | — | Onboarding not complete
  - Kim, Jisoo, PT | 1356728401 | Shelby Sports Rehab | 1 | NC — exp Jun 30, 2027 | — | — | Onboarding not complete
  - Nguyen, Thao, OT | 1467839512 | — | 0 | NC — exp Mar 31, 2027 | Sep 2, 2026 | — | Onboarding not complete
  - Ortiz, Lena, PTA | 1578940623 | Shelby Sports Rehab | 1 | NC — exp Dec 31, 2026 | — | — | Onboarding not complete
  - Park, Owen, PT | 1689051734 | Shelby Sports Rehab | 2 | NC · SC — exp Jan 31, 2027 | Aug 14, 2026 | 0 of 0 approved | — (no flag)
  - Rao, Anita, PT | — | Shelby Sports Rehab | 1 | — | — | — | Onboarding not complete
- Footer "Showing 6 of 47 providers."

---

## 6b. Provider record: Onboarding card (where actions live)

- Board: "6b. Provider record: Onboarding card (where actions live)". File: RecordOnboarding.dc.html. Desktop 1280x900. Page `<title>` "Provider record: the Onboarding card".
- Who sees it: Jordan Seed (Minted coordinator).

Layout:

- Same left nav as 6a.
- Breadcrumb "Providers › Ortiz, Lena". h1 "Lena Ortiz, PTA". Sub "Shelby Sports Rehab · Charlotte · starts Nov 10, 2026". Button "Edit".
- Section tabs (HTML comment: "Record section tabs/anchors as on the record page today, plus Onboarding"): Onboarding (active), Identity, Groups & facilities, Licenses, Documents, Notes. No Readiness tab, per canvas decision "6b: the Readiness tab is hidden while a provider is onboarding and comes back after hand-off."
- Onboarding card. HTML comment: "shown while status = onboarding; collapses to a one-line history after hand-off".
  - h2 "Onboarding". Buttons "Resend invitation", "Mark contacted".
  - Five-step indicator (HTML comment: "same component as the owner view"): Invited (done), Started (done), Submitted (current, blue), Ready for credentialing, In credentialing.
  - Detail list:
    - Waiting on: **Minted** · submitted, ready for review
    - Invited: Oct 13 · lena.ortiz@example.test
    - Record: Pending verification · from a roster upload
    - Reminders sent: 1 · stopped at submit
  - "Verification **10 of 13 confirmed · 3 pending**". HTML comment: "one block, source-agnostic. A row's chip and 'by' change when a check is automated; the layout does not."
    - Table columns: Check | Status | By | (action).
    - Pending rows (By "—"): "CAQH login" Pending, button "Test…" (aria "Test CAQH login"); "PECOS login" Pending, button "Test…" (aria "Test PECOS login"); "NC PTA license" Pending, button "Confirm".
    - Collapsed `<details>` "10 confirmed · Auto", each row Confirmed / By "Auto":
      1. NPI
      2. CAQH ID
      3. CAQH attested within 120 days
      4. License per target state · NC
      5. Date of birth and SSN on file
      6. CAQH and PECOS logins on file
      7. Group W-9, COI, contract, location in state
      8. Required documents on file (CV, license copy)
      9. No duplicate NPI in group
      10. Group and location assigned
    - Note: "Test reveals the login after a typed reason, logs it, then confirms."
  - Hand-off bar: "One click confirms the record, assigns Shelby Sports Rehab · Charlotte, and marks Lena ready for credentialing. She becomes active when her first payer application is generated." Button "Admit & assign".
- "Activity" section (HTML comment: "Notes & audit: the existing provider notes surface, where onboarding events already land"):
  - Oct 13 · 9:40 am: Record created · roster upload
  - Oct 13 · 9:40 am: Invited
  - Oct 15 · 10:00 am: Reminder sent · Start your application
  - Oct 15 · 6:52 pm: Signed in with a code
  - Oct 15 · 6:54 pm: Signed the consent · copy in Documents
  - Oct 16 · 7:46 pm: Uploaded 2 documents · CV, NC license
  - Oct 16 · 7:48 pm: Submitted · automatic checks ran
  - Note field: label "Add a note", textarea placeholder "Called the front desk; she starts Nov 10…".

---

## 7a. Reporting index: Provider Onboarding report is a new card

- Board: "7a. Reporting index: Provider Onboarding report is a new card". File: ReportsIndex.dc.html. Desktop 1280x900.
- Who sees it: Jordan Seed (Minted coordinator).

Layout:

- Same left nav (Reporting not linked in this file's nav; Providers links to 6a). h1 "Reporting".
- Sections of cards (title / description):
  - Intake (HTML comment: "existing Inbound Leads + NEW Provider Onboarding report"):
    - "Provider Onboarding report" [New badge]: "Who's in onboarding now and where each one is, Minted's time from ready for credentialing to applications submitted, and Needs a human." Right-side pill "4 need a human". Links to 7b.
    - "Inbound Leads": "Website inquiries awaiting triage — convert to an organization or dismiss."
  - Credentialing:
    - Denials: "Who has been denied, by whom, and why — provider-first, payer-pivotable, CSV."
    - Billing Readiness: "Which providers can bill which payers, and what is blocking the rest."
    - Expiring Credentials: "Licenses, DEA, and documents approaching expiry."
    - Roster Engine: "Payer roster exports, templates, mapping, and history."
    - Group Contracts Matrix: "Contracts by group and payer."
    - Enrollment Explorer: "Review published payer enrollment by provider, group, product, and location."
  - Performance:
    - Portfolio: "Your organizations across the business — prospects, in motion, and geography."
    - Launches: "Locations opening soon or recently — dates, providers, and at-risk flags."
    - Facilities Without Providers: "Active locations with no providers assigned."
    - Locations per Group: "Active location counts by provider group."
  - Compliance:
    - Audit Log: "Who did what, when — the append-only change ledger with filters."

---

## 7b. Provider Onboarding report

- Board: "7b. Provider Onboarding report". File: Pipeline.dc.html. Desktop 1280x820.
- Who sees it: Jordan Seed (Minted coordinator). A "Share read-only link" button implies an external reader.

Layout:

- Same left nav. Header: breadcrumb "Reporting › Intake"; h1 "Provider Onboarding report". HTML comment: "title left, period + filters right (Square / Calendly / Gumloop convention)". Right: selects Period (Last 90 days, Last 30 days, Last 12 months), Group (All groups), Location (All locations); button "Share read-only link".
- KPI tiles. HTML comment: "the only target is Minted's own step, Ready for credentialing → first application submitted. Submitted → ready can wait on the provider (fixes, failed login tests), so it is measured, never targeted."
  - "In onboarding now": 9; "23 invited in the last 90 days"
  - "Needs a human": 4; "2 reminders paused · 1 duplicate · 1 no reply"
  - "Ready → first application submitted · median": 2.0 days; "Minted's step · target 2 business days"
  - "Submitted → ready for credentialing · median": 7.6h; "measured, no target · can wait on the provider"
- Chart card "Ready → first application submitted, by week". Sub: "Minted's step · median business days · dashed line = 2-day target". HTML comment: "Target set Oct 19: 2 business days. Dashed line at 2.0 days; weeks over it are amber."
  - Weekly bars (tooltips): Jul 21 3.1 days; Jul 28 2.8; Aug 4 2.9; Aug 11 2.4; Aug 18 2.2 (all over target); Aug 25 2.0 (within); Sep 1 2.1 (over); Sep 8 1.9; Sep 15 1.7; Sep 22 1.8; Sep 29 1.6; Oct 6 1.8 (within).
  - Dashed line label "2-day target". X labels Jul 21, Aug 18, Sep 15, Oct 6. Legend "within target", "over target".
  - Footnote: "Clock starts at Ready for credentialing and stops when the first payer application is submitted. Time before she's ready isn't counted."
- Card "Where they are now": "9 providers in onboarding". Stacked bar and legend (each links to 6a): Invited 2, Started 2, Submitted 2, Ready for credentialing 3. Then "Waiting on the provider 4", "Waiting on Minted 5".
- Card "Provider pace" ("measured for monitoring · no targets"):
  - Invitation to first sign-in · median: 21 hrs
  - Invitation to submitted · median: 2.4 days
  - Ready for credentialing within 7 days of invitation: 18 of 23
  - Reminders sent per provider · median: 1
  - Note: "Shown only on this report. The provider sets the pace."
- Card "Needs a human" with link "View all". Each row links to 6a:
  - "Kim, Jisoo · PT": "Asked for help · reminders paused" [Help]
  - "Haddad, Sami · OT": "“I was told I don't need to do this” · reminders paused" [Told not needed]
  - "Nguyen, Thao · OT": "Same NPI twice in Shelby Sports Rehab · resolve before hand-off" [Duplicate]
  - "Okafor, Grace · PT": "No reply after 3 reminders · practice emailed" [No reply]

Annotations: canvas decision "7b: Minted's one target is Ready for credentialing → first payer application submitted, under 2 business days."

---

## 8. Reminder email: Complete your application

- Board: "8. Reminder email: Complete your application". File: Nudge.dc.html. Mobile mail client 390x844.
- Who sees it: Anita Rao. From "Shelby Sports Rehab via Minted Panel", 8:00 AM.

Layout:

- Subject: "Complete your application for Shelby Sports Rehab".
- Body (HTML comment: "a plain transactional template"):
  - "Hi Anita,"
  - "Your answers are saved. A few details are still needed to complete your credentialing application with Shelby Sports Rehab."
  - Button "Complete your application" (to screen 3).
  - "Enter your email and we'll send a fresh code. Your saved answers will be there."
  - Links "I need help", "I was told I don't need to do this".
  - "Thanks,<br>Shelby Sports Rehab"
- Footer: "Sent by Minted Panel on behalf of Shelby Sports Rehab" / "Shelby Sports Rehab · 410 Mint St, Charlotte, NC 28202" / link "Why am I receiving this?".
- No reassurance placeholder and no "Questions? Just reply" line, unlike screen 2.

---

## Cross-screen observations

Contradictions and drift

1. Screen 0 and screen 1 are both "Owner" views of Dana Shelby but differ. Role label: 0 shows only "Dana Shelby"; 1 shows "Dana Shelby · Office Manager" and a "Client view · Shelby Sports Rehab" tag. Page title: 0 is "New hires"; 1 is "Onboarding". Counts: 0 has a different data set (Jisoo Kim is present, with 5 rows) than 1 (4 rows, no Jisoo). Screen 1's counters are Invited 2, Started 1, Submitted 1, Ready 3, but its table shows 1 row in each of Invited, Started, Submitted and Ready (so 2 and 3 are not matched by rows). These could be one screen or two; the canvas treats 0 as the home and 1 as the dialog context.
2. Stage naming. Screen 0 labels "Waiting on" by who (You, Anita, Marcus, Minted). Screen 1 uses names only (Anita, Marcus, Minted); there is no "You" bucket, and no "Needs you" section on 1. Screen 0 button labels "I've contacted her" / "Contacted"; screens 1 and 6b use "Mark contacted".
3. Reminders column exists on 1 and in 6b's detail list, but not on 0.
4. Screen 1 row actions for Lena and Owen are "Read only", while 0 shows no action cell. Screen 1 includes "Resend" only for Anita (Invited), consistent with 0, but 0 also gives Jisoo "Resend".
5. Counts across reports: 6a "Onboarding 6", 7b "In onboarding now 9", 1 shows 2+1+1+3 = 7, 0 shows 5 rows. The mocks use different data sets and do not reconcile. Within 6a, the toggle's 6 matches the 6 rows. The 6a roster includes Nguyen, Thao (OT) with no group and 0 facilities, flagged "Onboarding not complete" and listed in 7b as a Duplicate; Thao is not on 0 or 1. Park, Owen is in the Onboarding list on 6a but has no flag; on 0 and 1 he is "ready for credentialing".
6. Reminder naming. 6b's Activity logs "Reminder sent · Start your application", but the only reminder template drawn (8) is "Complete your application", and it says "Your answers are saved", which would not fit a first nudge sent before any sign-in. A "Start your application" template is not drawn.
7. Lena Ortiz timeline. 6b's Activity says reminder sent Oct 15 10:00 am, signed in 6:52 pm, submitted Oct 16. The email at 8:00 AM (8) is addressed to Anita. Lena's invite source is "roster upload" (6b), but screen 1's dialog says "Hiring several at once? Send Minted your spreadsheet", and the 6a upload card is "Minted-only in v1". Consistent only if Minted staff did the upload. The memory note says roster upload is deferred.
8. Email (2) says "Your CV and a copy of your state license" and "Your mobile number and home address". Gateway (3) helper lists only "NPI, license, CAQH ID, and your CAQH and PECOS logins", omitting SSN/DOB, mobile/home address and documents. The email also omits date of birth and SSN, which the form requires.
9. Email (2) bullet "Your state license number and expiration date" matches Form license fields. "Your PECOS login (username and password)": Form labels the field "User ID", not "Username".
10. Gateway 4b State B text says "enter your email above", but State B is drawn alone with an "Enter my email" button and no email field above it.
11. 6b "Reminders sent 1 · stopped at submit" versus the 7b statement "Reminders sent per provider · median 1". Consistent. 5a "I need help" is described as pausing reminders and appearing in "Needs you" (0) and "Needs a human" (7b). Jisoo is in both. The 0 mock says Jisoo "asked for help on Oct 15", and 6a shows she has a NC license and NPI on file.
12. Screen 5 consent copy asks the provider to "provide us with your NPI and CAQH and PECOS login". Form logins line says "Used only to file and keep up your payer applications." The wording differs in purpose (maintenance vs filing). Not contradictory, but both are user-facing legal-ish copy.
13. Canvas readme says "Read left to right, row 1 then row 2", but the actual positions put 6b at y=2950 in a third row, and 7a, 7b, 8 on row 2.
14. Tracker (6a) header says "No coordinator invite: single hires come from the practice's Invite button". Screen 6b has "Resend invitation" for the coordinator, so the coordinator can resend, not invite.
15. 6b's Verification row "Required documents on file (CV, license copy)" matches 5b required set, but 5b's required set also depends on "one license copy per state on the form", while 6b names only "NC PTA license" and "License per target state · NC".
16. Dates: 5 shows Oct 19, 2026 as the consent date; 5a source label "From Shelby's roster · Aug 12". Anita's invite email is timestamped 2:11 PM with no date. 6b says Lena was invited Oct 13.

Features referenced on one screen only

- Test reveal of logins after a typed reason (6b only).
- Admit & assign hand-off (6b only), "Group W-9, COI, contract, location in state" verification (6b only).
- CSV upload with Invite / Add as existing per row and "Invite these N providers" (6a only; D7).
- "Share read-only link" (7b only).
- Template 9 confirmation email (mentioned in 5c's comment, not drawn).
- Consent copy stored in Documents (mentioned in 5 and 6b, not drawn on 5b).
- "I need help" and "I was told I don't need to do this" actions appear in emails and 5, 5a, 5b but their landing is not drawn; 7b shows the outcomes.
- Spec references: D7, D10, D22, Q3, R2.3, rule 5, template 9. No definitions are in the source.
- Phone-photo upload (5b only).
- State filter on 0 only. Group and Location filters on 7b only.

Field lists compared: Form (5a) vs Documents (5b) vs RecordOnboarding (6b)

Form (5a), 15 data fields, 4 progress sections:

- Identity (7): First name *, Last name *, NPI *, Specialty *, Date of birth *, CAQH ID *, Social Security number *.
- Contact (3): Email (no *), Mobile phone *, Home address * (single field).
- Licenses (3 per row): State *, License number *, Expires *.
- Logins (4): CAQH ProView Username *, Password *; PECOS User ID *, Password *.
- Progress counts: Identity 3 of 7 (First, Last, NPI), Contact 1 of 3, Licenses 0 of 1, Logins 0 of 2. The Specialty default and the prefilled license State "NC" are not counted as complete.
- Not on the form: consent checkbox (moved to 5), mailing vs home address split, Group/facility, start date.

Documents (5b):

- Required: CV *, one "<state> license copy" * per license on the form (NC shown).
- Optional: Diploma, Board certification, Your own liability insurance, Something else.
- Rules: PDF, JPG or PNG, up to 10 MB each.
- Not on 5b: consent copy, W-9, COI, contract.

RecordOnboarding (6b) verification checks versus what the provider supplies:

- NPI, CAQH ID, CAQH attested within 120 days (not collected on the form; the CAQH ID is, attestation date is not), License per target state, Date of birth and SSN on file, CAQH and PECOS logins on file, Required documents on file (CV, license copy), plus pending CAQH login, PECOS login, NC PTA license.
- Checks with no provider-side input: Group W-9/COI/contract/location in state, No duplicate NPI in group, Group and location assigned.
- Form fields with no verification check in 6b: Specialty, Mobile phone, Home address, Email (sent as verified via code), license number/expiration as separate checks, optional documents.
- Mismatch: the form collects Specialty (taxonomy code) and Mobile phone/Home address; 6b's check list does not mention any of them, though the readiness service in the repo reduces DOB, SSN and home address to presence booleans.
- 6b shows "NC PTA license" (role-specific license name), 5b shows "NC license copy", 6a shows the license as "NC — exp <date>", 5a shows "State licenses" with a single "State" code field.
- Specialty on 5a is PT-only options (Physical Therapist, PT · Orthopedic, Sports, Neurology, Pediatrics), while the group roster includes OT (Nguyen, Haddad) and PTA (Ortiz) providers in 6a and 7b. Anita is a PT and Lena is a PTA, so the form shows PT specialties only.
