---

## epic: e0.2 title: Org CRM Contact Fields (Customer & Sales Rep) stage: 0 status: draft owner: chatprd reviewed: false

# E0.2 — Org CRM Contact Fields (Customer & Sales Rep)

## 1\. Summary & Business Goal

Enable any organization record in Minted Panel to capture valid, schema-aligned customer and sales rep contact info at creation/edit: phone, email, split address, label. Standardize for onboarding, escalation, and billing clarity. Powered by scenario seed-universe and tied to Stage 0 build constraints. No credentialing manager assignment at org shell—clean CRM only.

## 2\. Scope

### In scope

* Required fields, validation, display, and edit for customer and Minted Panel sales rep contacts
* Data aligned to schema (split address, labels not freeform)
* Playwright/UI demo/test hooks for seed-universe mapping

### Out of scope

* Assignment of credentialing managers/cases to orgs
* Notes, comments, fax, audit log, or credentialing ops fields
* Stage 1/2/3 feature stubs or downstream surfaces

## 3\. Functional Requirements

FR-1. Every org must have a Sales Rep (default Zeb) and a Customer Contact (seed-universe mapped). Both must have schema-aligned fields: name, email, phone, address (line1, line2, city, state, postal_code, country if schema). FR-2. Contacts required on creation and editing. Org cannot be saved if required fields are missing/invalid. FR-3. Contact info is always visible/labelled in org workspace overview. FR-4. All org contacts can be edited at any time, no history/audit/log needed. No additional required validation beyond schema field constraints. FR-5. Demo/test org data always uses \[seed-universe.md\]. Playwright must verify demo contacts are present/correct.

## 4\. UX & Design Notes

* Use: shadcn/ui Form, Input, Label, Button; Card/List/Detail for contact display.
* Refer to Stage 0 build constraints for component limits: no custom UI primitives, extend from existing form control set.
* Seed demo: Use real names (Zeb for Sales, P5 for customer; demo: Coach Eric Taylor, Kitty Forman, etc.). Split address fields vertically in layout for clarity.

## 5\. Technical Considerations & Enablers

* DB must already support contact info at org. If not, create migration ticket but design remains additive.
* Use services/hooks pattern—no direct Supabase calls in components.
* Seed test data via baseline DB script, not Playwright only.

## 6\. Acceptance Criteria

### FR-1 (Contacts & Fields)

* [ ] Both contacts present per org, with schema-aligned fields populated and validated




### FR-2 (Validation)

* [ ] Cannot save org with missing/invalid required contact fields (name, email, phone, address per schema)




### FR-3 (Display)

* [ ] Contact info, clearly labelled, always shows in org workspace




### FR-4 (Edit)

* [ ] All fields always editable after creation; no logs/audit kept




### FR-5 (Seed/Demo)

* [ ] Zeb is always sales in seed/demo orgs; customer contact is per seed mapping; can verify through Playwright & workspace UI




Gherkin — see Features for per-feature scenarios.

## 7\. Dependencies & Risks

* Requires org-level CRM schema (address split, phone/email fields, label constraints) in DB and service layer
* Maintenance of \[seed-universe.md\] in demo and test for correct mapping
* Any change to schema must be additive only, never destructive

## Features

### F2.1 — Add/Edit Customer Contact

**Description:** User can add or edit a customer escalation contact at org create/edit; all fields validated and address is split. **Persona:** P1 Credentialing Manager; P5 Practice Owner (for review, not editing) **Benefit Hypothesis:** Always-available escalation maintains accountability and responds to practice-side needs instantly. **Acceptance Criteria:**

* Required on create
* Name, email, phone, full split address (schema)
* Error/guide if any field invalid/missing **Test/Data Scenario:**
* TS-0, TS-1, TS-5; Outer Banks, Point Place, Dillon

```gherkin
Feature: Customer contact escalation
  Scenario: Customer contact required per schema fields
    Given I create 'Outer Banks Rehab Group'
    When I fill name, email, phone, and full address
    Then the org is saved and contact is present in UI

```

### F2.2 — Add/Edit Sales Rep (Zeb default)

**Description:** Zeb Loewenstine is present as sales rep in every org; role and address, phone, and email editable as needed per schema. **Persona:** P1 **Benefit Hypothesis:** Sales accountability keeps accounts manageable and avoids confusion in escalation/churn. **Acceptance Criteria:**

* Always present (cannot be removed if only sales rep)
* May edit name, email, phone, address at any time **Test Scenario:**
* TS-5, seed-universe all orgs

```gherkin
Feature: Sales rep always present
  Scenario: Sales rep (Zeb) required, label correct
    Given I edit 'Point Place Physical Therapy'
    When I delete sales rep email
    Then cannot save until valid email present

```

### F2.3 — Display Contacts in Workspace

**Description:** Org workspace always shows both contacts clearly labelled with all info (schema fields); immediate refresh on update. **Persona:** P1 **Benefit Hypothesis:** Users never have to dig for contacts when escalation is urgent; uniform display removes ambiguity. **Acceptance Criteria:**

* Contacts list/section is visible in org workspace; updates are real time **Test Scenario:**
* TS-3

```gherkin
Feature: Visible contact list
  Scenario: Edit appears immediately
    Given org 'Dillon Sports Medicine' with contacts set
    When I update customer contact phone
    Then new value is saved and shows in workspace instantly

```

...

## Scenario/Seed Data Mapping

| Test scenario | Org(s)/User(s) | Purpose |
| --- | --- | --- |
| TS-0 | Outer Banks Rehab Group | Baseline required contacts |
| TS-5 | All orgs, Zeb + seed customer contact | Full portfolio demo, edit, field validation |
| TS-3 | Dillon Sports Medicine | Real-time update clarity |

## Revision History

* 2026-07-08, chatprd, Aligned to Master Template — feature/AC/Persona/seed-universe rigor enforced.

---