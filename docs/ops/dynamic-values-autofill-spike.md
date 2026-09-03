# DYNVAL spike — dynamic values and the structured-control gaps

**Status:** findings only, **no product code in this PR**.
**Date:** 2026-09-03 · **Branch:** `claude/dynamic-values-healthcare-9o0yod`
**Source:** PM enhancement list, "Dynamic values / radio options / drift traps"
**Repos read:** `sonny303/mintedpanel` @ this branch, `sonny303/minted-extension` @ `a51fd71`
**DB read:** hosted `fkvuhfsqcmujywzgczmc` (live object + row inspection, read-only)

Companion: [`E6.10-structured-control-autofill.md`](../redesign/E6.10-structured-control-autofill.md) ·
[`train-dual-registry-spike.md`](./train-dual-registry-spike.md)

---

## The one-line answer

Every gap in the list is feasible. But the list's **priority order is wrong**,
and the live fill telemetry says so plainly: **the single largest defect in the
autofill system is not in the list at all.**

The fill engine has no page awareness. On a multi-page portal it attempts every
approved mapping for the whole portal while the coordinator sits on one page,
and every other page's field reports `field not found on this page` — the exact
string `src/lib/formDrift.ts` treats as **drift**. The drift badge, the payer
funnel's drift column and `fragileMapIds` are all reading that noise as signal.

---

## Evidence

All 35 real (non-test) fills, 2026-08-13 → 2026-08-31, 577 fields landed.

| Skip reason                                 |  Events | What it means                 |
| ------------------------------------------- | ------: | ----------------------------- |
| `field not found on this page`              | **490** | counted as drift today        |
| `Captured for the shared form library`      |     108 | by design (manual rows)       |
| `no value in Minted Panel`                  |      78 | real data gap on the provider |
| vocabulary mismatch (`no option matches …`) |  **15** | the E6.10 problem             |
| `field is disabled or read-only`            |       9 | page state                    |
| `user.name` not set                         |       8 | fix on /account               |
| file upload                                 |       8 | permanent manual              |
| `empty_token`                               |       3 | dry-run shape                 |

Now split those 490 by portal:

| Portal               | Captured pages | Approved maps | Fills | Fields filled | `field not found` |
| -------------------- | -------------: | ------------: | ----: | ------------: | ----------------: |
| `aetna_direct`       |          **9** |            60 |    24 |           111 |           **490** |
| `bcbs-ks`            |              1 |            78 |     3 |           149 |             **0** |
| `humana-tricare`     |              1 |            53 |     6 |           254 |             **0** |
| `payer-form:…` (PDF) |              — |             — |     2 |            31 |                 0 |

**100% of the drift signal comes from the one multi-page portal. Single-page
portals report zero.** That is not a coincidence, it is the mechanism.

Per-fill on Aetna it reads: 2 filled / 41 not found · 3 / 38 · 5 / 30 · 1 / 42.
And it got worse as training progressed — 7–13 not-found per fill on Aug 13,
30–42 by Aug 31. More pages captured, more false drift. The signal degrades
with exactly the behaviour we want coordinators to do more of.

### Why it happens, by path

- `minted-extension/src/background/api.ts:362` — `getPortalFieldMaps(portalKey)`
  fetches **every** map for the portal. No page or URL filter.
- `minted-extension/src/background/fill.ts:89` — `planFill` iterates all of
  them, filtering only on `mapType`, `status`, `source` and value presence.
  `pageStep` is never read.
- `minted-extension/src/content/fillEngine.ts:270` — an unresolvable selector
  reports `field not found on this page`.
- `src/lib/formDrift.ts:19,98` — that exact string, with `kind: "skipped"`, is
  the drift predicate.

Capture is already page-aware and visibility-aware
(`captureScan.ts` `scanCapturableFields` captures **visible controls only**;
`shared/capture.ts` `mergePageCapture` buckets rows by `pageStep`). **The fill
is the half that never got the same treatment.** That asymmetry is the bug.

### Second-order risk from the same cause

A wizard that keeps inactive panels in the DOM (hidden, not unmounted) behaves
worse, not better: `resolveTarget` uses `querySelector`, which finds hidden
elements, and the engine has no visibility check on the fill side. Those fields
get **written into a hidden panel**, counted as filled, and nobody is told.
Aetna's numbers show unmounting, so we have not been bitten yet — but the next
portal decides that for us, and today we would not detect it.

---

## Verdict table

Ranked by evidence, not by the order in the list. Cost is engineering days for
one competent session including tests; "repos" is where the change lands.

| #     | Gap                                                      | Verdict                                 | Cost      | Repos            |
| ----- | -------------------------------------------------------- | --------------------------------------- | --------- | ---------------- |
| **0** | **Fill is page-blind → false drift** _(not in the list)_ | **Real, dominant, cheap**               | **1–2 d** | ext only         |
| 1     | Dynamic values (`system.today`)                          | Real, small today, cheap                | 2–3 d     | panel only       |
| 2a    | Radio/select value↔label mismatch                        | **Already shipped** (E6.10)             | 0         | —                |
| 2b    | Cascading / async-loaded options                         | Real, unaddressed                       | 2–3 d     | ext only         |
| 2c    | Div-based / shadow-DOM controls                          | Real, explicit non-goal                 | 5–8 d     | ext only         |
| 3     | Conditional fields → false drift                         | Real, but see #0 first                  | 1–2 d     | panel + 1 column |
| 4     | Input masks (phone, TIN, ZIP)                            | Real, and a live 3-way drift            | 1–2 d     | ext + panel      |
| 5     | Multi-step wizards                                       | **Capture shipped; fill is #0**         | 0 + #0    | —                |
| 6     | Auth timeout / 2FA / CAPTCHA                             | **Mostly shipped**; cadence unevidenced | 0–1 d     | ext only         |
| 7     | Re-capture destroys mappings                             | **Already shipped** (E6.9 + E6.10)      | 0         | —                |

Three of the seven are already built. That is the same pattern the E6.10 spike
found in the previous design doc, and it is worth saying out loud: the analysis
is describing a system one or two epics behind the code.

---

## Gap 0 — fill is page-blind (recommended P0)

**Feasible, extension-only, no schema change, no wire-contract change.**

`pageStep` is _already on the wire_. `minted-extension/src/shared/apiTypes.ts:40`
carries it on `PortalFieldMap`, and `src/services/portalFieldMaps.ts:35` already
selects `page_step`. The extension has the data and ignores it.

Better still, the extension can **re-derive the page's identity the same way it
named it**. `derivePageStep` (`minted-extension/src/shared/trainForms.ts:65`) is
machine-derived, not hand-typed: heading → URL tail → capture sequence. The live
Aetna values bear that out — `location-one`, `provider-info`, `np-check`,
`join-the-aetna-network` are URL tails; only `Page 5` fell through to the
sequence fallback. So at fill time the content script can compute the same
identity and compare it to each map's stored `pageStep`.

Recommended shape — **report, do not re-plan**:

1. Content script resolves selectors as it does now.
2. Compute the current page's identity with `derivePageStep`'s own inputs
   (heading + URL tail). Maps whose `pageStep` matches are **this page**.
3. If identity is inconclusive — a JSF-style wizard that never changes URL or
   heading, which is exactly the `Page 5` case — fall back to scoring each
   `pageStep` bucket by how many of its selectors _did_ resolve; the best bucket
   is the page on screen.
4. Unresolved fields on the current page are **genuine drift** and keep
   `kind: "skipped"`. Every other page's get a new `kind: "other_page"` and a
   reason that says so.
5. `src/lib/formDrift.ts` already filters on `kind === "skipped"`, so it drops
   them with **no panel change at all**.

Reusing `derivePageStep` matters beyond convenience: capture and fill then name
pages through one function, so they cannot drift apart the way capture and fill
already have on page awareness.

Why report rather than plan: planning only the current page would silently
shrink coverage numbers and make "we can supply M of N" mean something
different per page. Reporting keeps the denominator honest and fixes the
signal.

**Degrades safely in both directions.** Old panel + new extension: the new kind
is not `"skipped"`, so drift under-counts (correct). New panel + old extension:
everything stays `"skipped"`, so it over-counts exactly as today. No coordinated
release required.

**Rejected alternative — panel-only heuristic.** I tested "a page where every
approved map reports not-found was not on screen" against the latest Aetna
fill. It misfires: page `location-one` shows 14 not-found of 17 approved and
was clearly _not_ the page on screen; the 3 unreported rows were manual/no-value
and never attempted. The panel cannot separate "not attempted" from "attempted
and found" because `fill_sessions.fields_filled` is an `int4` **count**, not a
list — `formDrift.ts:155` already flags this limitation. Page attribution has to
come from the extension, which is the only party that knows.

**Bonus, same change:** add a visibility check on the fill side so a resolved
but hidden control is skipped with its own reason rather than written into an
inactive panel. Mirrors `isCapturableControl` in `captureScan.ts`.

---

## Gap 1 — dynamic values (`system.today`)

**Feasible, panel-only for the web fill, and cheaper than the list assumes —
but smaller than the list assumes too.**

### Confirmed: there is no runtime date anywhere

`get_sop_field_tokens()` returns **152 tokens across 9 tables**, all
schema-derived. The picker adds two hand-owned families —
`user.*` (5 keys, `src/services/tokenCatalog.ts:22`) and the org-contact
families (`src/lib/quickCardCatalog.ts:140`). None of the 152 is a clock read.
A coordinator's only options today are a fixed literal that goes stale, or
"a person fills this".

### The pattern already exists, twice

`user.*` is precisely this: a code-owned token family with no schema behind it,
appended to the picker and resolved at the API read boundary
(`src/server/extensionRoutes.ts:171`, `src/server/userTokens.ts`). `system.*`
is the same shape with a simpler resolver — no DB read at all.

Touch list for the **web** path:

| File                                 | Change                                               |
| ------------------------------------ | ---------------------------------------------------- |
| `src/services/tokenCatalog.ts`       | add `SYSTEM_TOKENS` beside `USER_TOKENS`             |
| `src/lib/quickCardCatalog.ts`        | add `SYSTEM_TOKEN_FIELDS` beside `USER_TOKEN_FIELDS` |
| `src/server/systemTokens.ts` _(new)_ | pure resolver, ~30 lines                             |
| `src/server/extensionRoutes.ts`      | one `profile.tokens.push(...)`                       |

CLAUDE.md's lockstep rule (catalog / quick-card list / resolver) applies
verbatim. Extension: **zero changes** — `planFill` reads
`profile.tokens` by name and does not care where a token came from.

### The catch the list missed: there are two resolvers, not one

The PDF path does **not** go through the server.
`src/routes/cases.$id.tsx:98` builds token values in the browser via
`buildProviderTokenValues` (`src/lib/pdfFill.ts:112`) → `entityTokenValues`
(`src/lib/entityTokens.ts`), whose `ENTITY_TOKEN_FAMILIES` is
`["provider", "group", "facility", "mso"]`.

That path already has a **latent defect worth its own fix**: the PDF field
mapper (`PayerFormFieldPanel.tsx:58`) offers the _same_ `useTokenCatalog()`,
`user.*` included — and the browser resolver cannot resolve `user.*` at all. Map
a PDF field to `user.name` today and it fills blank, permanently, with no
warning. **221 of 470 field maps are `map_type = 'pdf'`.** Adding `system.*`
naively would repeat that mistake on a bigger surface.

So gap 1 is really two items: the `system.*` family (cheap), and closing the
picker/resolver divergence between the two fill paths (the thing that makes it
safe).

### Formatting is 80% solved, and there is a live 3-way drift

`transform` already ships end to end: authorable in the registry
(`FieldRegistryList.tsx:446`), applied on real fills
(`minted-extension/src/background/fill.ts:54`), on the mock dry run, and on the
PDF path (`src/lib/payerFormFill.ts:52`).

But the three layers disagree about what a transform _is_:

| Layer                                                          | Allowed transforms                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| DB check constraint `portal_field_maps_transform_check`        | `date_mmddyyyy`, `state_abbrev`, **`phone_digits`**, **`uppercase`** |
| Panel `AUTHORABLE_TRANSFORMS` (`src/lib/controlOptions.ts:10`) | `date_mmddyyyy`, `state_abbrev`                                      |
| Extension `applyTransform`                                     | `date_mmddyyyy`, `state_abbrev`                                      |

`phone_digits` and `uppercase` are accepted by the database and **silently
no-op** in both fill engines (`applyTransform`'s `default:` returns the raw
value). Nothing writes them today — 4 live rows carry `date_mmddyyyy`, all
others NULL — so this is a landmine, not a fire. Any mask work must close it
rather than add a fifth value to the pile.

Recommended token set, deliberately minimal:

- `system.today` — ISO `YYYY-MM-DD`, shaped by the existing `date_mmddyyyy`
  transform when the portal wants slashes.
- **Defer `@system.today(+30d)` offset syntax.** It turns a token key into a
  mini-language, and `portal_field_maps.token` is a plain string matched
  literally against the profile token list (`tokenFormat.ts` `normalizeTokenKey`
  exists precisely to keep that join a string compare). An offset needs a
  parser on both sides of a locked wire contract. No evidence yet that any
  payer form needs one.
- **Defer `case.*` entirely.** `/api/providers/:id/profile` takes `state` and
  `facilityId` — **there is no case in its scope**. `case.created_date` would
  mean widening a locked, PHI-dense wire contract or merging two responses in
  the extension. Different, larger job.

### Timezone is the one real design decision

The server resolves `system.today` — in whose day? A Kansas coordinator filing
at 7pm CT is already "tomorrow" in UTC. Options: UTC (wrong ~5 hours a day),
org timezone (no such column exists), or the **caller's timezone sent as a
request parameter**. That is a PM call, not an engineering one, and it is the
question I would want answered before any build.

### Honest sizing

The corpus does not yet show the pain the list describes. Of 470 field maps,
only **7** date-shaped rows are decided-manual, and most date fields already
have real tokens: `provider.dateOfBirth`, `license.expirationDate`,
`facility.effectiveDate`, `provider.caqhLastAttestedDate`,
`assignment.startDate`. The genuinely dynamic ones are the signature and
application-date boxes — 3 to 5 fields today, on 4 trained portals.

That is a _small_ current benefit and a _certain_ future one: every payer
application and attestation page has a date-signed box. Cheap enough to be
worth doing. Not the thing to do first.

---

## Gaps 2, 5, 7 — largely already built

**2a — value/label mismatch: shipped.** E6.10 landed in both repos.
`portal_field_maps.control_options` exists on hosted (verified);
`fillEngine.ts` `applySelect` matches exact value → normalized label →
normalized value; `applyRadio` matches value or label across the `name` group;
fixed values are picked from the portal's own vocabulary; the mismatch reason
names the control and samples what it accepts.

Real residual: **95 of 161 structured rows (59%) have no captured vocabulary** —
captured before E6.10 or by an older extension build. E6.10 F6.10.3 says such a
row must say so and point at re-capture. Worth confirming that copy actually
renders, and worth a re-capture pass on the three trained portals. That is
operations, not engineering. It also explains why only 15 vocabulary mismatches
appear in telemetry: most structured rows are still undecided
(**246 of 470 rows are `proposed`**), so they never fill and never report.

**5 — multi-step wizards: capture is shipped, fill is gap 0.** `page_step` is a
column, on the wire, and grouped in the registry
(`fieldRegistry.ts:143`); `mergePageCapture` appends a page without disturbing
other pages, and rescues hand-picked rows a scan no longer sees. The list's
recommendation ("allow Capture Current Step incrementally, appending") describes
code that already exists. The unbuilt half is the fill.

**7 — re-capture merge: shipped.** Re-capture refreshes the _presentation_ set
only (`sort_order`, `field_label`, `form_section`, `control_options`) and never
touches `status`, `token`, `source`, `hardcoded_value`, `notes`, `display_label`
or `section` — E6.10 F6.10.2 plus migration
`20260810143000_bite_cap02_shared_propose_presentation_refresh.sql`. An empty
option list on re-capture is _ignored_, not written, so a half-loaded page cannot
erase a good vocabulary. Removed fields surface through the drift layer rather
than being deleted. The list's "3-way reconciliation" is the shipped behaviour.

**2b — cascading/async options: real and open.** `applyFill`
(`fillEngine.ts:263`) is a synchronous `for` loop with no waits. Selecting a
state that triggers an AJAX county fetch, then setting county in the same tick,
fails. E6.10 OQ-1 acknowledged the capture half and deferred it. Extension-only:
make `applyFill` async and yield after a control whose `fieldType` is
`select`/`radio` when a later instruction is still unresolved. Retry-once-then-report
is better than a fixed sleep — a fixed 300ms is a guess that is simultaneously
too slow for 40 fields and too fast for a slow payer.

**2c — div-based / shadow-DOM controls: real, and a genuinely bigger job.**
`Fillable` is `HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement`
(`fillEngine.ts:22`); `resolveTarget` returns null for anything else. Capture
partially sees `[role='radiogroup']` as a _grouping_ hint
(`captureScan.ts:178`) but the `FILLABLE` scan is native-only. Supporting
`role="radio"` / `role="combobox"` means synthesizing pointer + keyboard
sequences per widget library, which is where browser automation goes to die.
E6.10 named it a non-goal; I would keep it there until a payer we actually need
forces it. Sizing (5–8 d) assumes ARIA-role widgets only — never shadow DOM,
which needs manifest and injection changes too.

---

## Gap 3 — conditional fields

**Real, and cheap — but do gap 0 first, because gap 0 may be most of it.**

A field mapped to a token that _has_ a value, on a branch the provider does not
take, is planned, not found, and counted as drift. Narrower than the list
implies: a conditional field whose token resolves empty already reports
`no_value` (`kind: "manual"`), which is not drift. Only the value-present case
misfires.

Cheapest correct fix: one additive nullable `boolean` on `portal_field_maps`
("this field only appears sometimes"), a checkbox in the registry, and one
predicate in `formDrift.ts` `brokenMapsForFill`. **No extension change** — drift
is derived entirely panel-side. The one thing to get right is that a conditional
field must still report normally in the fill summary, so the coordinator sees
"skipped, conditional" rather than nothing.

Sequencing matters: today it is impossible to tell a conditional-field
not-found from an off-page not-found, because 100% of not-founds come from the
9-page portal. Ship gap 0, watch one week of telemetry, then decide whether gap
3 still has a population. It may not.

---

## Gap 4 — input masks

**Real, small, and the fix is a transform, not a new mechanism.**

`setNativeValue` (`fillEngine.ts:86`) writes through the prototype setter and
fires `input` + `change`, which most mask libraries (Cleave, IMask) listen for
and reformat correctly. The failure case is masks driven by `keydown` /
`beforeinput`, which never see a programmatic set.

Panel-side shaping is the honest fix, and the mechanism is already there and
tested. Adding `phone_us` / `tin_ein` / `zip5` means: extend `applyTransform`,
extend `applyRegistryTransform` (`payerFormFill.ts:52`), extend
`AUTHORABLE_TRANSFORMS`, and **reconcile the DB constraint** — including
deciding what to do with the orphaned `phone_digits` and `uppercase` values
(implement them or drop them from the constraint; leaving them is how a future
session ships a silent no-op).

Constraint on any such change, from E6.10 F6.10.5: the stored strings must match
the extension's `applyTransform` switch **exactly**. An unknown transform there
fills the raw value rather than dropping the field, so a typo degrades quietly.
That is why the enum is code-owned on both sides and why the drift above is
worth closing in the same PR.

---

## Gap 6 — auth, 2FA, CAPTCHA, cadence

**Preflight recognition is shipped.** `matchPortalByUrl`
(`minted-extension/src/shared/portals.ts:47`) resolves the active tab against
the portal registry by longest origin+path prefix; the panel has an
unsupported-tab state (`docs/design-restyle/after/1b-unsupported-tab.png`), and
`fillPortal` pings the content script before it hands over any PHI
(`fill.ts:241`) with reload guidance when the ping fails. The list's
recommendation here is a description of current behaviour.

**Manual submit is already locked forever.** Locked decision 6: the extension
never submits; the human submits, the extension logs.

**Bot-detection cadence: unevidenced.** No CAPTCHA, rate-limit or block appears
anywhere in 44 fill sessions across three payer portals. Human-speed typing
would slow every fill for a risk we have not observed. If the async work in 2b
lands, the yields it introduces give some pacing for free. I would not build for
this until a portal actually blocks us — and then the fix is evidence-shaped,
not a guess.

---

## Recommended order

1. **Gap 0 — page-aware skip reporting.** 1–2 d, extension only, no schema, no
   contract change, degrades safely. Recovers a diagnostic signal that is
   currently ~80% noise and getting worse with every page trained.
2. **Re-capture the three trained portals.** Operations, not engineering. Fills
   in the 95 structured rows missing a vocabulary and works the 246 undecided
   rows. Largest coverage gain per hour on this list.
3. **Gap 1 — `system.today`, plus closing the two-resolver divergence.** 2–3 d,
   panel only. Needs the timezone decision first.
4. **Gap 4 — mask transforms + reconcile the transform enum across all three
   layers.** 1–2 d. Small, and it removes a live landmine.
5. **Gap 2b — async/cascading control handling.** 2–3 d, extension only.
6. **Gap 3 — conditional-field flag,** _only if_ telemetry still shows a
   population after step 1.
7. **Gap 2c — custom widgets.** Keep as a non-goal until a payer we need forces
   it.

---

## Open questions for the PM

- **OQ-1 (blocking gap 1).** Whose "today"? UTC, an org timezone column we do
  not have, or the caller's timezone as a request parameter?
- **OQ-2.** Should `user.*` resolve on the **PDF** path too? It is offered in
  that picker today and fills blank. Fixing it is a separate small item; leaving
  it means `system.*` should be web-only, which is its own inconsistency.
- **OQ-3.** Is `phone_digits` / `uppercase` in the DB constraint intentional
  (a planned build) or leftover? It decides whether gap 4 implements them or
  drops them.
- **OQ-4.** Does any _currently trained_ payer form actually have a
  future-dated "requested effective date" box? If not, the offset-syntax
  deferral above stands without further discussion.

## What I did not verify

- No browser run against a live payer portal — sandbox egress to `*.supabase.co`
  is blocked and the portals need authenticated sessions. Every DOM claim comes
  from reading `fillEngine.ts` / `captureScan.ts`, not from observing a page.
- The Aetna page-attribution analysis rests on `page_step` being a faithful
  record of which wizard step each field belongs to. It is machine-derived
  (`derivePageStep`: heading → URL tail → sequence), which is stronger than a
  hand-typed label, but two steps sharing a heading _and_ a URL would collapse
  into one bucket. That would weaken the per-page breakdown — not the headline,
  which holds on the portal-level split alone (9 pages → 490 not-found;
  1 page → 0).
- I did not confirm that the E6.10 "structured control with no captured
  vocabulary" copy renders as specified. Worth 10 minutes before step 2.
