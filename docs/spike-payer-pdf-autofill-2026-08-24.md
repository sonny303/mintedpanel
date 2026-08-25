# Spike — Portal field mapping for payer-PDF auto-fill

**Date:** 2026-08-24 · **Status:** feasibility, no code changed · **Recommendation:** phased build, starting with a defect fix

---

## Recommendation in one paragraph

**Build it, phased — but start with two bug fixes, not features.** Minted Panel
already ships a client-side payer-PDF auto-filler (`src/lib/pdfFill.ts` +
`pdfFillClient.ts`, rendered by `PdfStep` in `StepDetails.tsx`, with `pdf-lib`
already a dependency). It fills **zero fields for every org today**, because the
only memory it reads (`field_dictionary`, confirmed rows) is empty on hosted and
**cannot be populated through any UI that exists** — see [Finding 2](#finding-2--the-shipped-filler-is-inert-and-cannot-be-un-inerted-through-the-ui).
Fixing that is days, not weeks. Beyond it, the right move is to stop mapping PDFs
through `field_dictionary` and map them through **`portal_field_maps`**, which
already carries the whole decision vocabulary, the trainer UI, transforms, and
drift repair. The schema anticipated this: `map_type` and `fill_sessions.fill_mode`
already accept `'pdf'`. **No new mapping UI is needed.** Second, a **case-less,
in-panel test-fill machine already exists but is dormant** (`src/lib/mockFillProfile.ts`
+ `computeTestRun`); two bug fixes + plumbing wire it to validate mappings inside
Payer Setup with a rendered preview — unblocking Phase 2 and eliminating post-deploy
discovery of broken mappings. The hard part is not the mapping or validation at all
— it is that **3 of the 4 sample payer PDFs have no fillable form fields whatsoever**,
and no amount of field mapping helps a flat PDF.

---

## What was measured

Four real payer PDFs supplied with the ticket, probed with `pypdf` for AcroForm
structure (raw output in [Appendix A](#appendix-a--raw-pdf-probe)).

| Form                                                | Pages | AcroForm fields                           | Widgets | Text layer |
| --------------------------------------------------- | ----- | ----------------------------------------- | ------- | ---------- |
| **PSCR — Cigna/ASH** Provider Status Change Request | 2     | **105** (71 text, 31 button, 3 container) | 111     | yes        |
| Optum/UHC New–Additional Office Location            | 3     | **0**                                     | 0       | yes        |
| Optum Individual Therapist Credentialing Form       | 1     | **0**                                     | 0       | yes        |
| RPN Provider Change / New Location Form             | 1     | **0** (no AcroForm at all)                | 0       | yes        |

None are image-only scans — all four carry an extractable text layer. Two of the
flat forms carry an empty `/AcroForm` dictionary, which is the signature of a
print-and-fax form exported from a layout tool, not a form anyone intended to be
filled electronically.

### Finding 1 — only 1 in 4 payer PDFs is machine-fillable

This is the number that should drive the roadmap decision. Field mapping — the
whole technique this spike was asked to evaluate — is only applicable to the
Cigna form. For the other three, there is no field to map to; auto-fill would
require **coordinate overlay** (draw text at an x/y position on the page), which
is an entirely different mechanism with its own authoring tool, its own drift
problem (the payer re-exports the PDF and every coordinate shifts), and no
overlap with `portal_field_maps`.

If the 1-in-4 ratio holds across the real payer library, a field-mapping build
covers roughly a quarter of payer forms. That does not make it a bad investment —
the Cigna form alone is 71 typed fields per submission — but it must not be sold
as "payer PDFs are now auto-filled."

### Finding 2 — the shipped filler is inert, and cannot be un-inerted through the UI

The existing filler resolves a PDF field name → catalog token through
`confirmedDictionaryMap` (`src/lib/pdfFill.ts:51`), which accepts **only**
`field_dictionary` rows with `status = 'confirmed'`. Three facts, each verified:

1. `field_dictionary` on hosted (`fkvuhfsqcmujywzgczmc`) holds **0 rows, across 0 orgs**.
2. `upsertDictionaryEntry` — the only writer — always inserts `status: 'suggested'`
   (`src/services/fieldDictionary.ts:63`), never `confirmed`.
3. `decideDictionaryEntry` — the only function that can promote a row to
   `confirmed` — has **no callers anywhere in `src/`**. The "Fix-it dictionary card"
   its comment refers to does not exist (there is no `src/components/fixit/`).

So the promotion step is unreachable, and the filler's mapping source is a
closed loop that can never fill. Worse, the one path that _does_ write the
dictionary is also not exercised in practice: all 184 `portal_field_maps` rows on
hosted are global-tier rows, and global training (`useTrainGlobalFieldMap` →
`trainGlobalFieldMap` RPC) never calls `upsertDictionaryEntry` — only the
org-tier `useApproveField` does. Approving 150 field maps has taught the PDF
filler nothing.

**Net: `PdfStep` renders, reads the PDF, reports "N fields · 0 will fill · N left
blank", and the Generate button stays disabled.** Any user who tried this feature
concluded it was broken. They were right.

### Finding 3 — PDF field names do not transfer between forms

The dictionary is keyed on `normalizeFieldLabel(<raw AcroForm field name>)`. The
Cigna form is a LiveCycle export, so its field names are hierarchical:

```
form1[0].MovingClinicFillIn[0].ProName[0]
form1[0].MovingClinicFillIn[0].PhysicalCity[0]
form1[0].PSCRPage2[0].WebsiteAddress[0]
```

**All 102 of its named fields normalize to keys carrying the `form1[0].…` prefix**,
which is unique to this file. A dictionary rule learned here can never match a
field on any other PDF. Measured cross-surface transfer, after camel-splitting
the leaf name to give it the best possible chance:

- Cigna leaf names vs. the 76 distinct approved web-portal field labels:
  **2 of 102 match** (`email address`, `phone number`) — **2%**.
- Cigna `/TU` tooltips vs. the same labels: **4 matches**, all the generic `name`.

Cross-portal reuse is no better where it already runs: of 91 distinct captured
labels across 4 portals, only **3 appear on more than one portal**, and all three
map to _conflicting_ tokens (`first name` → `provider.firstName` on BCBS-KS but
`user.firstName` on Humana; `email address` → `group.billingEmail` vs
`group.credentialingEmail`). Those conflicts are correct — the same words mean
different things on different forms — which is exactly why label memory must stay
a _suggestion_, never an auto-apply.

### Finding 4 — the schema already anticipated PDF maps

No DDL is needed to start:

| Object                              | State                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `portal_field_maps.map_type`        | `CHECK (map_type IN ('web','pdf'))` — **already allows `pdf`**                                                                          |
| `fill_sessions.fill_mode`           | `CHECK (fill_mode IN ('web','pdf'))` — **already allows `pdf`**                                                                         |
| `FillMode` (TS, both repos)         | `"web" \| "pdf"` — already declared                                                                                                     |
| `portal_field_maps` unique keys     | `(portal_key, selector)` global, `(org_id, portal_key, selector)` org — a synthetic `portal_key` per form family fits with no migration |
| `portal_field_maps.control_options` | captures a checkbox's export-value vocabulary — exactly what the Cigna form's 31 buttons need                                           |
| `payer_forms`                       | global table, family/version grain, private bucket, signing routes built. **0 rows on hosted** — the feature is built but unused        |
| `pdf-lib@1.17.1`                    | already a panel dependency, lazily imported, client-only                                                                                |

The extension's fill planner already hard-skips `map.mapType !== "web"`
(`background/fill.ts:96`), so adding `pdf` rows to the shared catalog cannot leak
into a web fill. That guard is a pre-existing safety property, not new work.

The one genuine schema gap is `portal_field_maps_transform_check`, which allows
only `date_mmddyyyy`, `phone_digits`, `state_abbrev`, `uppercase` — none of which
can extract _part_ of a value. See Phase 3.

### Finding 5 — coverage on the one fillable form

The token catalog (`get_sop_field_tokens()`) currently exposes **152 tokens**.
Classifying the Cigna form's 71 text fields against it by hand:

| Bucket                             | Fields | What it needs                                                                                                                                                                                                                                                            |
| ---------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fills today with an existing token | **32** | nothing beyond the fill step (`group.name`, `group.tin`, `facility.street/suite/city/state/zip` ×2 blocks, `group.billing*`, `group.correspondence*`, `provider.npi`, `provider.caqhId`, `provider.licenseNumber`, `provider.credentials`, `user.name`, `user.title`, …) |
| Needs a value-**part** transform   |      9 | `Month`/`Day`/`Year` split of a date; `PhoneNumber`/`ANI1`/`ANI2` and the fax triple — area/prefix/line split                                                                                                                                                            |
| Needs a structured extractor       |     14 | `MonFrom`…`SatTo` from `facility.hours`                                                                                                                                                                                                                                  |
| Needs a composite token            |      1 | `PracName1` is one box for a full name; the catalog has `provider.firstName`/`lastName` but no composite (`user.name` is the existing precedent)                                                                                                                         |
| Second roster row — grain mismatch |      5 | `PracName2`/`NPI2`/`License2`/`CAQH2`/`ProfDistinc2` — one form, several providers                                                                                                                                                                                       |
| Genuinely human                    |     10 | `Comments`, `SignDate`, `ChgNPIFrom/To`, `Remove*`, `Other*` — correctly `source='manual'`                                                                                                                                                                               |

**32/71 (45%) today → 41 (58%) with part transforms → 55 (77%) with the hours
extractor and a composite name token.** Of the 31 buttons, the specialty
checkboxes are mappable from `facility.treatingCategories`; the section A–O
toggles ("am I moving / closing / adding a clinic?") are human decisions and
should stay `manual`.

Also worth noting: **59 of 102 fields carry a `/TU` tooltip** ("Contracted
Rehabilitative Services Provider Name:", "CAQH #", "Prof. Distinction:"). That is
a far better `field_label` than the field name, and it is free — it is the PDF
equivalent of the label text the extension's DOM capture already harvests.

---

## The four key questions, answered

### Q1 — Can one mapping be reused across multiple payer PDFs sharing field structure?

**Not across different payer PDFs. Yes across versions of the same form.**

Measured transfer between different forms is 2% ([Finding 3](#finding-3--pdf-field-names-do-not-transfer-between-forms)), and where labels
_do_ collide they collide with conflicting meanings. Two forms "sharing field
structure" in a human sense do not share field _names_, which is what any
literal-match mapping joins on.

What genuinely reuses is the grain `payer_forms` already has: **the family**.
Replacing a blank form (v1 → v2) keeps `family_id`, so mappings keyed to the
family survive the replace as long as the payer did not rename fields — which is
exactly the same bet the web mapper already makes on CSS selectors, and it has
the same repair path (drift detection → re-import → the trainer's "not found in
the latest fill" state).

Across forms, the reusable asset is the **suggestion**, not the mapping.
`src/lib/labelLearning.ts` already implements precisely this, with the honest
evidence unit ("we've mapped this label on 3 other payers"). Point it at PDF
fields using the `/TU` tooltip as the label and it does useful work on day one.
It must never auto-approve.

### Q2 — How do we handle PDFs with different field layouts for the same payer-state?

**Already solved by the existing grain — don't add anything.** Mapping is keyed
per _form family_, not per payer-state, so two layouts are two families and two
mappings, with no conflict to resolve. The E6 payer-PDF rules already push
authors this way: payer and states are read-only context inherited from the SOP
template, and "a form that applies to only some of a multi-state template's
states belongs on its own single-state template."

The one thing to preserve is the existing two-grain discipline: a template action
points at a **family**, a generated case task bakes a concrete **row**. A case
therefore keeps the exact file _and_ the mapping generation it was created with,
and a later replace reaches new cases only. Any PDF-mapping design that keys off
the _template_ rather than the _family_ breaks that and should be rejected.

### Q3 — What is the effort for auto-fill vs. manual user entry?

**Build effort: ≈ 8–14 dev-days for fillable PDFs** (Phases 1–3 below), on top of
machinery that already exists. Flat PDFs are a separate, much larger programme
and are not included.

**Payback, per form:** an admin makes ~102 field decisions once to map the Cigna
form. A coordinator typing it by hand fills ~71 text fields per submission; after
Phase 3 auto-fill supplies ~55 of them. So the mapping pays for itself once the
form has been submitted roughly **2–3 times** — trivially met for a payer form
attached to a live SOP template (it fires per provider × payer × state), and never
met for a one-off form. That is the rule to put in front of admins: _map the forms
on your templates; hand-fill the one-offs._

The import step matters more than it looks. Importing the PDF's fields as
`proposed` rows with tooltip-derived labels turns those 102 decisions from
_typing_ into _reviewing_, which is the same economics that made the web
trainer usable.

### Q4 — Do we need a new mapping UI, or can we reuse the existing one?

**Reuse it. Build no new mapping UI.** `FieldRegistryList.tsx` (487 lines) and
`FormStepPanel.tsx` (560 lines) already render exactly the surface a PDF needs:
sectioned field list in page order, per-field decision (token / fixed value /
"a person fills this"), rename without clobbering the captured label, coverage
read-out, broken-mappings-first ordering, and the token picker. Every one of those
concepts maps 1:1 onto a PDF field.

`classifyFieldMap` is exhaustive over `(status, source)` and fails closed — it
needs no new branch for PDFs, because "PDF-ness" lives in `map_type`, not in the
decision state.

What _is_ new is small and none of it is a mapping UI:

1. an **import** action ("read fields from this blank PDF") on the payer-form
   record, replacing the extension's DOM capture as the row source;
2. a **mount point** — Payer Setup → the payer-form family, beside the existing
   upload;
3. a **fill + download** action on the case task, replacing today's file picker.

---

## Recommended approach — phased

### Phase 0 — decide, then fix or delete (0.5 day)

`PdfStep` is user-visible and cannot work. Either fix it in Phase 1 or hide it
now. Shipping a permanently-empty "0 will fill" panel is worse than shipping
nothing. **Recommend: hide it behind the Phase 1 work rather than fixing the
`field_dictionary` path**, which Phase 1 replaces anyway.

### Phase 1 — PDF field maps on `portal_field_maps` (≈4–6 days)

The core of the build. No DDL.

1. **Import** the blank PDF's AcroForm fields (server-side or admin-side; `pdf-lib`
   is already present) into `portal_field_maps` as `status='proposed'`,
   `map_type='pdf'`, `portal_key='payer-form:<familyId>'`, `selector=<full field
name>`, `field_label=<tooltip> ?? <camel-split leaf name>`,
   `form_section=<subform>`, `sort_order=<widget order>`,
   `control_options=<checkbox export values>`.
   Re-import is drift **repair**, matching the existing re-capture rule: refresh
   presentation columns, never touch decisions.
2. **Fill** from the baked `payer_forms` row on the case task — the coordinator
   never uploads a file. The signing route (`GET /api/payer-forms/:id/download`)
   already exists.
3. **Plan** the fill with the same rules as the web planner: only `approved`
   fills, `hardcoded` writes its literal, `manual` is listed not filled,
   `manual_partial` fills _and_ flags. Apply `applyTransform`.
4. **Log** a `fill_sessions` row with `fill_mode='pdf'` and write a touch. The
   filled PDF stays editable and is never submitted — the human submits, per the
   locked decision.

**Isolation-gate note:** if any of this lands as an `/api` route, it needs
assertions in `scripts/verify-org-isolation.mjs` before merge. `payer_forms` is
global with a **role**, not tenancy, wall — gate assertions 28/28b/28c/29 already
pin that and must keep passing.

### Phase 1.5 — in-panel test fills for validation (≈1–2 days, unblocks Phase 2)

**A critical UX and verification layer you flagged: testing without a case or
provider.** This already exists, dormant, and should be wired for PDF immediately
after Phase 1 import.

Minted Panel ships a **case-less, PHI-free dry-run machine**
(`src/services/fillSessions.ts:273` `recordTestFillFromApp`, `src/lib/testRunResults.ts`
`computeTestRun`, `src/lib/mockFillProfile.ts` — a versioned synthetic profile). It was
built for web portals (E6.5), worked well, then **removed from the form-setup UI in
PR #311 (Aug 12)** because web training requires the extension's live-DOM access —
hence "go prove in Workbench." That constraint does **not** apply to PDF: a blank
`payer_forms` file is already readable client-side, so a test fill can run entirely
inside the Payer Setup wizard.

**What to do:**

1. **Fix `recordTestFillFromApp`** to accept `fill_mode: 'web'|'pdf'` instead of
   hardcoding `fill_mode: 'web'`. Today it always writes web, which mislabels
   PDF test fills.
2. **Fix `computeTestRun` source-blindness:** it currently returns `unmapped` for
   every field with `token === null`. But `hardcoded` rows (59 of 184 global rows
   today) have `token = null` by design and fill their literal value anyway.
   Branch on `source`: only `proposed` with no token is truly unmapped; `hardcoded`
   → `filled`; `manual` → list but don't fill. Without this fix, the test fill
   will report false `unmapped` counts.
3. **Mount a "Test fill" action** on the PDF action panel in `FormStepPanel.tsx`
   — *not a new wizard step*, but a sibling to the existing register/train workflow.
   Run `computeTestRun(maps, mockFillValues)`, then optionally render a preview
   or download of the filled PDF so the trainer can visually inspect coverage
   before taking it live. Label it clearly: "Sample fill (Sample… data)."
4. **Update `mockFillProfile.ts` token map** as Phase 3 adds composite/extractor
   tokens — any newly cataloged token must have a sample value or it falls through
   to heuristics and can report false `empty_token`.

**Why this matters:** the spike recommended Phases 1–3 cost ≈8–14 dev-days with
zero in-editor validation — trainers would map fields, generate a case, and *then*
discover a broken mapping or coverage gap. This fills that gap for the cost of two
bug fixes + plumbing to a UI that already exists. It also answers "did the mapping
work" with a real filled PDF visual, not a coverage percentage, which is
incomparably better fidelity than what web can offer (the extension's DOM injection
needs a live page; here you have the file + mappings in hand already).

**Isolation gate:** if Phase 1.5 lands as an `/api/pdf-test-fill` route for
multi-org callers, add assertions to `scripts/verify-org-isolation.mjs`. The
in-app path (browser-side, under RLS) needs nothing extra.

### Phase 2 — mount the existing trainer (≈2–3 days)

Wire `FormStepPanel` / `FieldRegistryList` to the `payer-form:<familyId>` key and
mount it on the payer-form record. Feed `suggestTokenForLabel` the tooltip label
so imported fields arrive with a suggestion and its evidence. Mostly plumbing.

### Phase 3 — the transforms the real forms need (≈3–5 days)

- **Additive migration** widening `portal_field_maps_transform_check` with
  part-extraction transforms (`date_month`, `date_day`, `date_year`, `phone_area`,
  `phone_prefix`, `phone_line`, or one generic `part:<n>` scheme). Covers 9/71
  Cigna fields. Mirror it in the extension's `applyTransform` so web and PDF fills
  never diverge — an unknown transform there falls back to the raw value, so the
  panel must not ship a transform the extension cannot read.
- **`facility.hours` per-day extractor** — 14/71 fields, the single biggest
  coverage jump.
- **A composite provider-name token.** Note this adds a catalog token and will trip
  the quick-card drift test by name until classified in
  `src/lib/quickCardCatalog.ts` — that is the test working, not a blocker. Keep
  `quickCardCatalog.ts`, `services/tokenCatalog.ts`, and the resolver in lockstep.

### Phase 4 — roster grain (defer; ≈1–2 weeks if pursued)

Several payer forms (Cigna's `PracName1/2`, and the Optum therapist form's four
`M.I.` rows) take **multiple providers on one sheet**. Every fill path in the
system today resolves exactly one provider profile. This is a real product
question — which providers, chosen by whom, from which case? — not just an
engineering one. **Do not bundle it into Phases 1–3.**

### Phase 5 — flat PDFs (decide separately, not costed here)

Three of four sample forms. Requires coordinate overlay, a visual placement tool,
and a drift story with no existing analogue. Before funding it, get the real
ratio: count fillable vs. flat across the actual payer-form library. If the
library is mostly flat, the cheaper win may not be auto-fill at all but a
**printable data sheet** — every value the form needs, on one page, in the form's
own order, for a human to copy — which reuses the token layer and needs no
mapping.

---

## Architecture decision: no new wizard step for PDF testing

The spike flagged UI confusion risk with mapping and testing flows. Here's why the
solution is *not* a new wizard step:

**The existing per-action lifecycle (`templateEditorIntent.ts`) already abstracts
register → train → test → prove** as derived banner states on the same collapsible
panel, not separate screens. Extending it for PDF is straightforward: add a "Test
fill" state (another derived banner condition) that mounts only when a PDF action
has mapped fields.

**Why PDF testing can live in-panel, unlike web:** Web training's dry run was
removed from the wizard (PR #311) and moved to the Workbench extension because
web forms require live-DOM access — there is no page to capture or dry-run against
inside Payer Setup. PDF has no such constraint. A blank `payer_forms` file is
readable client-side by `pdf-lib` immediately, so test fills run entirely in the
browser, entirely inside the wizard, with zero extension dependency. This is
strictly superior: web trainers go to the extension; PDF trainers stay in one UI
with a real rendered preview of what will fill.

**Result: one mental model for both.** An action in any form (web or PDF) is
registered, mapped, and tested/proven using the exact same intent-banner lifecycle.
The actuation differs only where it must: web's test fires in the extension
(DOM-driven); PDF's fires in-panel (file-driven). Attempting to unify both paths
mechanically would reverse a decision (PR #311) made for a real, still-true
constraint, and would break exactly the UI clarity you were concerned about.
Instead, present them as what they are: "PDF mapping tests faster because the form
is already in hand."

---

## Risks

1. **Sample size is four.** The 1-in-4 fillable ratio drives the whole
   recommendation and rests on four files. Counting the real library is a
   half-day and should happen before Phase 1 is scheduled.
2. **PHI.** A filled payer PDF is the most PHI-dense artifact the product
   produces. Today's filler keeps values in the browser and never persists them;
   Phase 1 must keep that property. If a filled PDF is ever stored, it needs its
   own retention decision — the `payer-forms` bucket holds _blank_ forms and is
   global, so a filled one must never land there.
3. **Field renames on re-export** silently break mappings, exactly as selector
   drift does on the web. The re-import-as-repair rule and the trainer's stale
   state handle it, but only if re-import is wired from the start.
4. **Prefilled shipping files.** The Cigna sample arrived with 47 of 105 fields
   already carrying values (a real practice's address, phone, email). A blank
   uploaded to `payer_forms` must genuinely be blank, or auto-fill will silently
   leave another org's data in the output. Worth a check at upload.
5. **`user.*` tokens.** `PrintName`/`SignTitle` map to `user.name`/`user.title`,
   which resolve from the caller's own `profiles` row. A key offered but not
   resolved maps a payer field to a permanent blank — keep the three lockstep
   surfaces in step.
6. **`computeTestRun` source-blindness (Phase 1.5).** The pure test-result
   classifier flags every field with `token === null` as unmapped. But
   `hardcoded` rows have `token = null` by design (the literal value lives in
   `fixed_value`) and should report `filled`. Without a source branch, the dry
   run reports false `unmapped` for 59 of today's 184 global rows, making the
   coverage number unreliable — the exact failure mode Finding 2 already
   documented. Fix before wiring Phase 1.5.

---

## Appendix A — raw PDF probe

Probed with `pypdf` 6.16.2. Widget count is `/Annots` of subtype `/Widget`.

```
NewAdditionalOfficeLocationUHCOptum.pdf       pages=3  acroform=yes  fields=0    widgets=0    xfa=no  text=4556 chars
Optum_Individual_Therapist_Credentialing.pdf  pages=1  acroform=yes  fields=0    widgets=0    xfa=no  text=1326 chars
RPN_Change_and_New_Location_Form.pdf          pages=1  acroform=NO   fields=0    widgets=0    xfa=no  text=2527 chars
PSCR_CIGNAASH.pdf                             pages=2  acroform=yes  fields=105  widgets=111  xfa=no  text=6684 chars
                                              └─ 71 text · 31 button · 3 container · 59 with /TU tooltips · 47 arrived prefilled
```

Cigna field-name shape (all 102 named fields share the `form1[0].` prefix):

```
form1[0].MovingClinicFillIn[0].ProName[0]        tooltip "Contracted Rehabilitative Services Provider Name:"
form1[0].MovingClinicFillIn[0].TINNumber[0]      tooltip "TINNumber"
form1[0].MovingClinicFillIn[0].PhysicalCity[0]   tooltip ""
form1[0].MovingClinicFillIn[0].ANI1[0]           tooltip ""          (phone prefix — 2nd of 3 boxes)
form1[0].PSCRPage2[0].CAQH1[0]                   tooltip "CAQH #"
form1[0].PSCRPage2[0].MonFrom[0]                 tooltip ""          (office hours grid)
```

## Appendix B — hosted state at time of writing

Project `fkvuhfsqcmujywzgczmc`, 2026-08-24.

| Table                    |      Count | Note                                                                                     |
| ------------------------ | ---------: | ---------------------------------------------------------------------------------------- |
| `portal_field_maps`      |        184 | **all global** (`org_id IS NULL`); 150 approved, 34 proposed; 4 portal keys              |
| — by portal              |            | `bcbs-ks` 96 · `humana-tricare` 60 · `aetna_direct` 26 · `humana-tricare-status-check` 2 |
| — by source              |            | 80 token · 59 hardcoded · 45 manual                                                      |
| `portals`                |          9 |                                                                                          |
| `field_dictionary`       |      **0** | the shipped PDF filler's only mapping source                                             |
| `payer_forms`            |      **0** | feature built, not yet used                                                              |
| `fill_sessions`          |         24 | all web                                                                                  |
| `get_sop_field_tokens()` | 152 tokens | schema-derived, not curated                                                              |

## Appendix C — dormant in-app test runner (Phase 1.5 prerequisites)

The codebase holds a working but unmounted case-less dry-run machine, built for
web form training (E6.5), then orphaned when trainers were asked to move to the
Workbench extension (PR #311, Aug 12). Relevant code:

| File                                | Role                                                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/mockFillProfile.ts`        | Versioned synthetic profile (`MOCK_FILL_PROFILE_VERSION`, curated token values). Deliberately fake ("Sample…"). Use as-is for Phase 1.5; update token map when Phase 3 adds composite/extractors. |
| `src/lib/testRunResults.ts`         | Pure per-field classifier: **has source-blindness bug** — returns `unmapped` for every `token === null`. Branch on source: `proposed` without token → unmapped; `hardcoded` → filled; `manual` → skip. |
| `src/services/fillSessions.ts:273`  | `recordTestFillFromApp(input: TestFillInput)` — **hardcodes `fill_mode: 'web'`**. Make parameter: `fill_mode: 'web' \| 'pdf'`. Inserts `case_id: null, is_test: true`.                      |
| `src/hooks/useFormOnboarding.ts`    | `useTestFills`, `useRecordTestFill` — no consumers, but API is clean. Hook these up to FormStepPanel test-fill action.                                                                  |

**What changed in PR #311 (removals, not deletions):** the UI mount point in
`FormStepPanel.tsx` was stripped (test-fill button, result display, mock-profile
inference). Service layer and pure logic remain untouched. Re-mounting requires no
schema changes and minimal scaffolding — two bug fixes (source branch, fill_mode
parameter) + one component callback to `useRecordTestFill` + optional PDF preview
render loop.

**Why not deleted:** e2e tests reference the hooks (`e2e/field-registry.spec.ts`
#311 kept the test logic but stubbed the UI). The machinery is load-bearing for
web training once the extension's Train tab captures it (currently stalled at "call
the API"); keeping the service layer undeleted was a hedge against web's eventual
completion. PDF's in-panel use is that hedge cashed in.
