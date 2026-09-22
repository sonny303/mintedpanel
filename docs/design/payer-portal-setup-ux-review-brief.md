# UX review brief — Payer Setup & Portal Setup

**Audience:** independent UI/UX designer (no prior Minted Panel context required)  
**Product:** Minted Panel — credentialing-operations SaaS for medical groups  
**Date:** 2026-09-02  
**Scope of redesign:** **front-end UX only** (information architecture, flows, screens, interaction design). Do **not** redesign the database, APIs, RPCs, or Chrome-extension capture protocol. Prefer reusing existing capabilities and surfaces; call out where a small additive UI affordance is needed on an already-shipped write path.

**Live app (reference):** https://mintedpanel.vercel.app  
**Primary nav entry:** Sidebar → **Payer Setup** → `/admin/payer-admin/setup`

---

## 1. Prompt for the designer

You are an independent UI/UX designer reviewing two related workflows in Minted Panel:

1. **Payer Setup** — making an insurance payer “ready for business” (identity in the catalog + enrollment checklist / SOP template).
2. **Portal Setup** — registering a payer’s web enrollment form, linking it to a checklist step, training field mappings, and keeping that form trustworthy over time (URL changes, drift, deletion/retirement).

These features are **usable today** but costly: too many clicks, deep nesting, and several maintenance jobs are missing or only reachable through retired/orphaned UI (notably **portal URL update** and **portal deletion / retirement**).

### What we need from you

Produce a **front-end redesign package** that an engineer can implement without inventing product policy. Prefer clarity and fewer steps over new concepts.

**Deliverables (expected):**

1. **Current-state journey map** (as-is) for both workflows — screens, decisions, dead ends, context switches (especially into the Chrome extension).
2. **Ideal-state journey map** framed as **goals + jobs to be done** (not backend schemas). Show the happy path and the maintenance path (update URL, retire portal, repair drift, republish template).
3. **Proposed IA / screen inventory** — what belongs on Payer Setup, Payer Detail, Template Editor, Form/Portal management, and what should be inline vs. a dedicated surface.
4. **Low- or mid-fidelity wireframes** for the critical screens and the missing maintenance affordances (edit URL, remove/retire portal, find “all portals for this payer”).
5. **Click-budget targets** — rough step counts for: (a) first-time portal payer setup, (b) update an existing portal URL, (c) remove a wrong/duplicate portal, (d) repair form drift.
6. **Open questions / risks** — especially where product policy is ambiguous (hard delete vs. soft retire; global vs. org portals; what happens to SOP steps that still point at a retired portal).
7. **Out of scope notes** — explicitly list anything that would require backend/API/extension protocol changes so engineering can park those.

### Design constraints (non-negotiable)

- **No backend redesign.** Tables, RPCs, and `/api` contracts stay as-is unless you flag a _tiny_ additive UI need on an **already existing** write path (e.g. `updatePortalUrl` already exists in code but is not reachable from the live Form setup UI).
- **Stay inside the product visual system:** primary `#1B4D3E`, border `#E8E5E0`, no card shadows/gradients, `rounded-md` for cards/inputs, status color only via pills. See shipped screens and `docs/redesign/design-system/` (do not invent a parallel brand).
- **Preserve domain grains** described in §4 (case key, global catalog, portal key immutability, template publish model). Redesign _how people reach and maintain_ those objects — not what the objects _are_.
- **Extension boundary stays:** the panel never submits payer portal forms. Capture and mock dry-run / Mark proven live in the **Minted Workbench Chrome extension**. The panel should make that handoff obvious and minimize round-trips, but should not pretend capture happens in-app.
- **Roles:** writers are `admin` / `specialist`; `billing` is read-only. Payer Setup is currently visible to all signed-in roles; write controls are admin-gated on several surfaces.

### Success looks like

A config user can answer, without hunting:

- “Is this payer ready?”
- “Where do I fix the portal URL?”
- “How do I remove a portal we registered by mistake?”
- “What is the one next step for this payer’s form?”

…and complete those jobs in far fewer clicks than today, without learning five retired URLs.

---

## 2. Product context (short)

**Users:** credentialing coordinators / managers at (or on behalf of) medical groups. They stand up payers once, then run cases day-to-day.

**What “ready” means in product language:**

| Signal                             | Meaning                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Published template**             | There is a published enrollment checklist (SOP) for this payer (tasks/steps coordinators follow on each case).               |
| **Form proven** (portal path only) | The payer’s online form is registered, fields are trained/mapped, and a mock dry-run was marked **Proven** in the extension. |
| **Drift**                          | A previously working mapping no longer matches the live page (needs repair).                                                 |
| **In network** (separate job)      | A **group** has attached the payer on Groups → Payer Network. Catalog presence ≠ operational use.                            |

**Important grain:** Payer Setup lists the **global payer catalog**. Creating a payer does **not** attach it to a group. Attachment is **payer × group × state** on the group’s Payer Network board.

**Global authoring:** Global SOPs, portals, and field maps (`org_id` null) are authored once and inherited by every org. Org-tier portals still exist for overrides; the Template Editor primarily authors **global** templates today.

---

## 3. Current workflows (as-is)

### 3.1 Map of live surfaces

| Surface                 | Route                                            | Role today                                                                                                      |
| ----------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Payer Setup** (list)  | `/admin/payer-admin/setup`                       | Landing: KPI filters + payer table + default-template card + “+ Set up payer”.                                  |
| **Add payer**           | `/admin/payers/new`                              | Create catalog identity (name, near-match guard, states, kind, IDs).                                            |
| **Payer Detail**        | `/admin/payer-admin/setup/$payerId`              | Tabs: Overview · Enrollments · Cases · **Templates** · Scorecard · Manage.                                      |
| **Template Editor**     | `/admin/templates/new`, `/admin/templates/$id`   | Wizard: **Basics → Actions → Review → Publish**. Portal machinery lives under an Action’s online-form step.     |
| **Form setup panel**    | Inline in Template Editor (collapsed by default) | Register/pick portal, train field registry, open form URL. Capture/prove instructed to happen in the extension. |
| **Group Payer Network** | `/groups/$groupId/payer-network`                 | Attach catalog payers to a group (operational enablement).                                                      |
| **Chrome extension**    | Workbench side panel                             | Capture form fields; Train forms → mock dry run → Mark proven.                                                  |

**Retired / redirected (do not design as primary homes):**

| Old URL                                                                                             | Today                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/portals`                                                                                    | Redirects to Payer Setup. Standalone **Portals registry UI still exists in code** (`PortalsRegistry`) but is **not mounted** — so Edit URL / registry browse from that page are effectively **gone from the product**. |
| `/portals/$portalKey/train`                                                                         | Standalone training deck retired; training is in Form setup + extension.                                                                                                                                               |
| `/admin/payer-admin/sops`, `/admin/templates` list, `/payer-directory`, legacy `/admin/payers` list | Redirect into Payer Setup / detail.                                                                                                                                                                                    |

### 3.2 Job A — First-time payer readiness (happy path, portal payer)

Typical click path today:

1. **Payer Setup** → **+ Set up payer** → complete identity → land on / return to catalog.
2. Open **Payer Detail** → **Templates** tab → see “Next step: Author template” (or similar).
3. **Create / open Template Editor**.
4. **Basics:** name, states (`All` or specific), optional group, required profile attributes.
5. **Actions:** add action (prefer Portal / Email / Custom presets) → set execution type (**Manual** or **Auto-fill**) → add **Online form** step → **pick or Register portal** (name, immutable key, optional URL).
6. Expand **Form setup** → **Open form** (new browser tab) → in **extension**: grant site access if needed → **Capture this form → Send for approval**.
7. Back in Form setup: decide each field (token / fixed value / human fills); broken mappings sort first.
8. In **extension Train forms**: mock dry run → **Mark proven**.
9. **Review → Publish** template.
10. Separately: **Groups → [group] → Payer Network → Attach payers** so generation/cases can use it.

**Pain:** readiness is split across list → detail → nested wizard → collapsed panel → external extension → back → publish → different module for attach. “Next step” CTAs were deliberately removed from the list page; they now live mainly on the Templates tab — easy to miss if the user stays on the list.

### 3.3 Job B — Portal maintenance (where it breaks)

| Job                           | As-is reality                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Review / update form URL**  | Service + hook exist (`updatePortalUrl`). UI lived on the **orphaned** Portals registry (inline editor + trust warning). **Form setup only shows “Open form”** — no edit control. Global portals can be upserted with a URL at register time via `upsert_global_portal`, but there is no clear “change URL later” affordance in the live editor. |
| **Delete / retire a portal**  | **No product UI** for delete or soft-retire. Wrong keys, duplicates, and abandoned registrations linger in pickers (ghost filtering only drops portals whose _payer_ is retired/merged/archived — not “I registered the wrong URL”).                                                                                                             |
| **Find all portals**          | No live registry page. Discovery is “open a template that already links the portal” or remember the key.                                                                                                                                                                                                                                         |
| **Repair drift**              | Possible inside Form setup (broken mappings queued first) / deep links with `?intent=repair`, but still nested under Template Editor Actions.                                                                                                                                                                                                    |
| **Re-train after URL change** | Backend clears verification + `proven_at` when URL updates (by design). Without a reachable URL editor, users cannot trigger that honest reset path from the UI they actually use.                                                                                                                                                               |
| **Rename portal key**         | **Immutable by design** (joins SOP steps, field maps, fill logs). UX must treat key as permanent identity — rename = create new + relink, not edit-in-place.                                                                                                                                                                                     |

### 3.4 Nested UI density (Template Editor)

Inside **Actions**, a single Auto-fill / Portal action may require:

- Action name, due offset, assignee defaults
- Execution type
- Step type / mode
- Portal picker + Register portal
- Collapsed **Form setup** (status pills: Not registered / Captured / Trained / Proven / broken counts)
- Field registry list (every row, including decided — good) with token pickers
- Footer copy pointing to the extension for prove

This is powerful but **optically and cognitively heavy**. Collapsing Form setup by default helps typing latency, but hides the maintenance jobs.

### 3.5 Related but separate: group attach

Do not merge this into “author the SOP” mentally — operators often finish a beautiful global template and then wonder why generation shows no candidates. Ideal UX should **acknowledge** the attach job without forcing backend changes (clear checklist / cross-link is enough).

---

## 4. Domain rules the redesign must respect

These are **product facts**, not suggestions:

1. **Payer identity** is global catalog; **operational membership** is group Payer Network targets.
2. **One published checklist story per payer** is the readiness spine; form readiness is a _secondary_ ladder for portal paths (a no-online-form SOP can still be “ready” with a note).
3. **Portal key** is the join key across SOP steps ↔ portals ↔ field maps ↔ fills. Immutable after create.
4. **One portal per task** (multiple online_form steps in one task with different keys conflict).
5. **Field map decisions:** token | fixed/hardcoded | human/manual. Stale/broken mappings stay visible and editable — staleness is information, not a lock.
6. **Proven** is a human stamp after mock dry-run in the extension — not automatic from the panel.
7. **Templates publish** via versioned publish (content); match-key edits are separate. Global tier is the default authoring path.
8. **Additive data policy:** prefer soft-retire / stop-using patterns over hard deletes in recommendations; if you propose “Delete portal,” specify whether you mean hide from pickers, unlink from steps, or true row delete — engineering will map to existing grants (today: no delete UI; org portal updates exist; global writes go through RPCs).

---

## 5. Ideal state — goals & jobs to be done (design targets)

Describe solutions in these terms. Wireframes should make each job **obvious, short, and recoverable**.

### Primary goals

| Goal                                 | Outcome                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1 — Ready at a glance**           | From Payer Setup / Detail, user sees whether the payer is checklist-ready and form-ready, and what the single next action is.                             |
| **G2 — One setup spine**             | First-time setup feels like one guided path (identity → checklist → form → prove → publish → attach), not five rediscovered pages.                        |
| **G3 — Maintain without spelunking** | URL change, portal retire/remove-from-use, remapping, and drift repair are first-class, reachable from the payer/portal the user is already looking at.   |
| **G4 — Honest extension handoffs**   | Capture and prove are clearly “do this in Workbench,” with return paths that land the user back on the same Form setup work.                              |
| **G5 — Safe defaults**               | Prevent duplicate payers (near-match), prevent orphan portal keys, warn when URL change invalidates mappings, never imply the app submitted a payer form. |

### Jobs to be done (JTBD)

**Payer Setup**

- When I add a payer we credential with, I want to record who they are once so every org/group can reuse that identity.
- When I open Payer Setup, I want to see which payers still need a template or a proven form so I know what to work next.
- When a payer is archived, I want to reactivate or leave it alone without losing history.

**Checklist / template**

- When I author how we enroll with a payer, I want a clear task list (actions/steps) with the right mode (portal vs email vs paper) so coordinators don’t invent process per case.
- When I publish, I want confidence the right states/groups will resolve this template — without understanding the resolver algorithm.

**Portal setup & training**

- When enrollment is via a website, I want to register the form once, capture fields, and map them to provider data so the extension can fill later.
- When I am deciding mappings, I want every field visible (including already decided ones) so I can fix mistakes.
- When I finish mapping, I want a dry-run prove step that doesn’t touch real PHI or submit anything.

**Portal maintenance (explicitly under-served today)**

- When the payer moves the form, I want to **update the URL**, understand that trust/proof resets, and re-capture/re-prove without recreating the portal key if possible.
- When I registered a duplicate or wrong portal, I want to **retire or remove it from pickers** and see which templates still reference it.
- When mappings break after a site redesign, I want a short repair queue, not a full re-author of the SOP.

**Enablement**

- When a group should actually work this payer, I want to attach it on the group network without confusing that step with catalog authoring.

### Ideal-state principles (UX)

1. **Maintenance parity with creation** — every create affordance has a visible update/retire path.
2. **Progressive disclosure** — advanced field registry stays powerful; casual URL/name/status edits should not require opening the full wizard.
3. **Payer-centric portal inventory** — “Portals for Aetna” should be findable without knowing a template id.
4. **Fewer context jumps** — batch instructions for extension capture/prove; deep-link back with intent.
5. **Don’t resurrect complexity** — avoid reintroducing five top-level admin apps; consolidate, don’t scatter again.
6. **Click budget (suggested targets for your proposal):**
   - Update portal URL: **≤ 3** purposeful clicks from Payer Detail (or a portal inventory).
   - Retire/remove portal from use: **≤ 4** clicks, with reference warning.
   - Open form training for a payer that already has a template: **≤ 3** clicks from Payer Detail Templates.

---

## 6. Known gaps to prioritize in the redesign

Use this as the review punch list (product-confirmed friction):

1. **No live portal URL edit** on Form setup; registry with Edit URL is unmounted.
2. **No portal delete / retire / “remove from pickers”** UX.
3. **No portal directory** in navigation after `/admin/portals` redirect.
4. **Deep nesting** for form work (Detail → Templates → Editor → Actions → step → Form setup).
5. **List page deliberately omits next-step CTAs** — readiness actionability concentrated on Templates tab.
6. **Capture/prove require extension** — panel copy is long; handoff is easy to misunderstand (“Open form” does **not** capture).
7. **Group attach is a separate module** — easy to think setup is “done” before the group can generate cases.
8. **Global vs org portal tier** — register dialog differs by template tier; users may not understand inheritance blast radius.

---

## 7. What “front-end only” still allows

Safe proposal space:

- New layouts, grouping, empty states, checklists, drawers, lightweight portal inventory views.
- Surfacing **existing** mutations that already have services/hooks (e.g. org `updatePortalUrl`, global `upsertGlobalPortal` with `id` for update, flag RPCs).
- Better deep links / intent params into Template Editor Form setup (intents already exist: register / train / repair / prove).
- Re-mounting or redesigning a Portals inventory **as UI composition** (the old component is a reference, not a mandate).

Flag for engineering/PM (do not assume):

- True hard-delete of portal rows or new soft-delete columns.
- Renaming `portal_key`.
- Moving capture/prove into the panel.
- Changing publish/version semantics or template resolution rules.
- Auto-attaching payers to groups on create.

---

## 8. Personas & scenarios to design against

| Persona                            | Need                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| **P1 Credentialing manager / ops** | Stands up many payers; cares about portfolio readiness and low maintenance cost.        |
| **P2 Coordinator**                 | Mostly runs cases; occasionally repairs drift or re-trains after a payer portal change. |

**Scenarios**

1. Brand-new commercial payer, portal enrollment, first template, prove, attach to one group.
2. Existing payer; payer moved enrollment URL last week; mappings look fine until fill fails.
3. Duplicate portal registered with typo key; need it gone from the picker.
4. Email/PDF-only Medicaid payer — no portal ladder; still “ready” after publish.
5. Drift badge on Payer Setup KPI → repair without re-writing the whole SOP.

---

## 9. Reference materials (read in this order)

1. This brief.
2. Live product walk of §3 routes (demo/UAT org).
3. Current wiki snapshot: `docs/wiki/payer-setup.md` (may lag slightly — trust live UI if conflict).
4. Prior design handoff (shipped direction, good vocabulary): `docs/redesign/design-reference/payer-and-cases/README.md` + screens `1–4`.
5. Operator runbook (config mental model): `docs/redesign/payer-onboarding-runbook.md`.
6. Historical consolidation intent: `docs/redesign/E6.5-payer-setup-consolidation.md` (context only — list IA has since moved to single-view Setup).
7. Orphaned portals admin spec (URL-edit patterns worth stealing, not re-shipping blindly): `docs/design/portals-admin-spec.md`.

**Code touchpoints (for engineer pairing, not required for design):**

- `src/components/payer-admin/PayerSetupPage.tsx`
- `src/components/payer-admin/PayerDetailPage.tsx` / `PayerTemplatesTab.tsx`
- `src/components/templates/TemplateWizard.tsx` / `TemplateTaskRow.tsx` / `FormStepPanel.tsx`
- `src/components/portals/PortalsRegistry.tsx` (unmounted reference)
- `src/services/portals.ts` (`updatePortalUrl`, `upsertGlobalPortal`, …)

---

## 10. Suggested review session agenda (60–90 min)

1. Facilitator walks Scenario 1 and Scenario 2 on production/demo (no slides).
2. Designer narrates friction aloud; note click counts.
3. Attempt URL update and portal removal — document failure modes.
4. Sketch ideal maintenance surfaces on paper/whiteboard.
5. Align on deliverable format and out-of-scope backend flags.

---

## 11. Copy-paste prompt (share with the designer)

> Please review Minted Panel’s **Payer Setup** and **Portal Setup** front-end workflows using `docs/design/payer-portal-setup-ux-review-brief.md` as the source of truth.
>
> The product is usable but high-friction: setup is deeply nested, and portal **URL update** and **deletion/retirement** are missing from the live UI (URL edit only existed on a retired/unmounted registry page).
>
> Deliver current-state and ideal-state journey maps framed as **goals and jobs to be done**, plus wireframes for a front-end-only redesign that reduces clicks and restores maintenance parity. Do not redesign the backend; preserve the domain rules in the brief; keep capture/prove in the Chrome extension; follow the existing visual system.
>
> Prioritize: (1) update portal link, (2) retire/remove bad portals, (3) shorter path from payer → form training, (4) clearer readiness next actions, (5) honest extension handoffs.

---

## Document ownership

- **Product owner:** PM (Minted Panel)
- **Implementation:** engineering after design package accepted
- **This file:** living brief — update if live routes or missing affordances change before the design engagement starts
