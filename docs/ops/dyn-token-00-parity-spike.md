# DYN-TOKEN-00 — token-parity prerequisite

**Status:** decision-ready findings. **The TOKEN-00 bite itself changed no
product code and no schema.** Build bites are separately approvable; the two
that have since landed are marked **BUILT** below.
**Date:** 2026-09-03 · **Bite:** `BITE-DYN-TOKEN-00`
**Depends on:** none. Ran parallel to the DYN-PAGE tranche (now fully merged).
**Blocks:** `BITE-DYN-TODAY-01` (browser-local `system.today`), per D-DYN-4.

**Sources:** panel `main` @ `1453101`; extension `main` @ `29cab21`; hosted
project `fkvuhfsqcmujywzgczmc`, read-only aggregate over `portal_field_maps`
(counts and token keys only — no values, no PHI). Every SQL statement used is
reproduced in [Appendix A](#appendix-a--the-queries).

Companion: [`dynamic-values-autofill-spike.md`](./dynamic-values-autofill-spike.md)
(PR #353) · [`dynval-handoff-2026-09-03.md`](./dynval-handoff-2026-09-03.md)

---

## Verdict

**One picker offers 157 tokens. Two resolvers reach different subsets of them,
and neither knows what the other can do.**

108 tokens (69%) resolve on both the web fill and the real payer-PDF fill. 24
(15%) resolve on web only. 25 (16%) resolve on neither, though the picker
offers them.

The good news is sharper than expected: **at fill time, neither resolver lies.**
The web profile returns `null` _with a named unresolved reason_; the PDF plan
classifies a missing value as `empty_token`, which `planPayerFormFill`
deliberately surfaces as a visible gap rather than a silent blank.

The dishonesty is upstream, in two places a trainer actually looks:

1. the **mapping picker**, which offers all 157 tokens on a PDF form with no
   signal that 49 of them cannot resolve there; and
2. the **sample fill**, whose `mockValueForToken` returns a plausible non-empty
   value for _any_ token by heuristic fallthrough — so a mapping that will
   never fill in a real case demos perfectly.

D-DYN-3 says an offered token means the same thing on both surfaces. Today it
does not, and `system.today` would be the 158th token added to that gap. That
is why D-DYN-4 makes this a prerequisite rather than a footnote inside the
dynamic-date build.

**The gap is latent, not active.** Zero live PDF mappings use a family the PDF
path cannot resolve (see [Live usage](#live-usage--the-gap-is-latent)). Nobody
is being burned right now. This is a trap that is set, not a fire.

---

## The offered set

`listTokenCatalog()` (`src/services/tokenCatalog.ts`) is `get_sop_field_tokens()`
plus a hand-written `USER_TOKENS` array. `useTokenCatalog()` serves it to
**both** mappers — `FormStepPanel` (web portal fields) and
`PayerFormFieldPanel` (payer PDF fields). One catalog, one picker, two
resolvers.

| Family           | Source table                    |  Tokens |
| ---------------- | ------------------------------- | ------: |
| `provider`       | `providers`                     |      46 |
| `group`          | `provider_groups`               |      39 |
| `facility`       | `facilities`                    |      23 |
| `payer`          | `payers`                        |      18 |
| `license`        | `state_licenses`                |       9 |
| `groupInsurance` | `group_insurance_policies`      |       7 |
| `contract`       | `contracts`                     |       5 |
| `assignment`     | `provider_facility_assignments` |       3 |
| `mso`            | `msos`                          |       2 |
| `user`           | _(no schema — appended)_        |       5 |
|                  | **Total**                       | **157** |

The catalog is **not curated**: `get_sop_field_tokens()` sweeps
`information_schema.columns` over nine tables. A new column on any of them
becomes a new offered token with no code change — and, today, with no check
that either resolver can reach it.

## The two resolvers

### Web — `getProviderProfile` + route appends

`src/services/providerProfile.ts`, served by
`GET /api/providers/:id/profile` (`src/server/extensionRoutes.ts`).

Six source rows are picked per request, each with an explicit column
projection: `providers`, `provider_groups`, `state_licenses`,
`provider_facility_assignments`, `facilities`, `group_insurance_policies`.
`CASE_SCOPED_TABLES` (`payers`, `msos`, `contracts`) short-circuits to `null`
plus `case-scoped source (<table>); resolve at fill time from the case
context`. The route then appends `user.*` (`resolveUserTokens`) and the
org-contact families.

Three honest failure modes, each carrying its own reason string: case-scoped
source, source row not resolved, and `column <c> not in the <table>
projection; update providerProfile.ts`.

**Projection check:** every one of the 49 distinct tokens in live approved use
is present in its table's projection. No live web mapping fails on the third
mode today.

### PDF — `buildProviderTokenValues`

`src/lib/pdfFill.ts:112`, called once at `src/routes/cases.$id.tsx:98` and
passed down through `CaseTasksPanel` → `PayerFormActionRow` → `planPayerFormFill`.

```ts
buildEntityTokenValues({ provider, group, facility }); // + composed facility.address
```

Three prefixes. That is the whole reach. It builds from entities the case page
already holds, deliberately — no extra fetch, PHI stays in the browser — and
`entityTokens.ts` says so plainly in its own comment: child-row families
(`assignment`, `groupInsurance`, `license`) and case-scoped families are _"NOT
here: no row is in hand."_

A token outside those three prefixes is simply absent from the map. It is not
mis-resolved, and `planPayerFormFill` reports it as `empty_token` — a gap the
coordinator sees before downloading.

## Capability matrix

| Family           | Tokens | Mapping picker  | Web fill                     | Real payer-PDF fill |
| ---------------- | -----: | --------------- | ---------------------------- | ------------------- |
| `provider`       |     46 | offered         | ✅ resolved                  | ✅ resolved         |
| `group`          |     39 | offered         | ✅ resolved                  | ✅ resolved         |
| `facility`       |     23 | offered         | ✅ resolved (by selection)   | ✅ resolved         |
| `license`        |      9 | offered         | ✅ resolved (by case state)  | ❌ no row in hand   |
| `groupInsurance` |      7 | offered         | ✅ resolved (policy pick)    | ❌ no row in hand   |
| `assignment`     |      3 | offered         | ✅ resolved (facility pick)  | ❌ no row in hand   |
| `user`           |      5 | offered         | ✅ resolved (caller profile) | ❌ not built        |
| `payer`          |     18 | offered         | ⚠️ null + reason             | ❌ no row in hand   |
| `contract`       |      5 | offered         | ⚠️ null + reason             | ❌ no row in hand   |
| `mso`            |      2 | offered         | ⚠️ null + reason             | ❌ not built        |
| org contacts     |      — | **not offered** | ✅ resolved (default holder) | ❌ not built        |

**Both:** 108 (69%) · **Web only:** 24 (15%) · **Neither:** 25 (16%).

⚠️ = offered but deliberately unresolvable without a case; the web path names
the reason rather than guessing. Not a bug — a documented boundary. It is still
a token the picker offers and no surface can fill.

Org contacts are the mirror-image defect: three families the web profile
resolves that the picker never offers, so nobody can map to them.

---

## The three named defects

### D1 — the sample fill cannot fail

`PayerFormFieldPanel.tsx:170` builds its sample values by calling
`mockValueForToken(token)` for every mapped token. That function
(`src/lib/mockFillProfile.ts`) ends in a heuristic fallthrough that is
documented as _"Deterministic; always non-empty."_

So `license.expirationDate` on a payer PDF samples as `2026-01-15` and fills
blank in every real case, forever. The trainer's only feedback signal confirms
a mapping that cannot work. **This is the highest-severity finding in this
spike** — it actively teaches the wrong thing.

Worth being precise about scope: `mockValueForToken` is correct for the _web_
dry run it was built for (E6.5 F6.5.3), where the mapping is the thing under
test and every family resolves. Reusing it for a PDF sample is what broke it.

### D2 — the picker is resolver-blind

One `useTokenCatalog()` feeds both mappers. On a payer PDF it offers all 157,
of which 49 (24 web-only + 25 neither) cannot resolve there — no marker, no
warning at save.
`groupTokens()` groups by family for readability — the information needed to
warn is already in hand, and unused.

### D3 — "license number" has two spellings with different parity

`providers` carries `license_number`, `license_state`, `license_issue_date`,
`license_expiration_date` — so `provider.licenseNumber` resolves on **both**
paths. `state_licenses` is the real per-state grain, so `license.licenseNumber`
resolves on **web only**.

Two tokens, same apparent meaning, opposite PDF behavior. Live data shows the
split already happening: `provider.licenseNumber` (1 web + 1 pdf),
`license.expirationDate` (2 web + 0 pdf), `license.issueDate` (1 web + 0 pdf).
Any parity work must state which one is canonical rather than quietly making
both work.

---

## Live usage — the gap is latent

Approved maps with `source = 'token'`, hosted, as of 2026-09-03:

| Family     | Web maps | Web distinct | PDF maps | PDF distinct |
| ---------- | -------: | -----------: | -------: | -----------: |
| `group`    |       49 |           24 |        7 |            6 |
| `facility` |       22 |            8 |        5 |            5 |
| `provider` |       22 |            9 |       12 |            8 |
| `user`     |        6 |            4 |        0 |            0 |
| `license`  |        3 |            2 |        0 |            0 |
| **Total**  |  **102** |              |   **24** |              |

**Every live PDF mapping is in a family the PDF path resolves.** Zero broken
mappings today. `assignment.*`, `groupInsurance.*`, `payer.*`, `mso.*` and
`contract.*` have no approved mapping anywhere, web or PDF.

Two consequences:

- **No migration is needed.** The DoD's "unsupported existing mappings have a
  migration/UX posture" resolves to: none exist; the posture is prevention.
- **The parity build is cheaper than the matrix suggests.** Nothing has to be
  un-broken. The work is closing the trap before someone steps in it.

That also reframes priority. D1 and D2 are the whole exposure. Building
resolvers for four unused families is speculative work; **stopping the picker
and the sample from advertising them is not.**

---

## Recommended posture per family

| Family                          | Posture                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `provider`, `group`, `facility` | **Parity is the contract.** Both paths resolve; pin it with a test so a new column can't silently break one side.            |
| `license`                       | **PDF parity BUILT** (TOKEN-05). Sample fill admits it via `PDF_FILL_FAMILIES`. `assignment.*` still needs PDF parity.       |
| `assignment`                    | **Build PDF parity.** Already resolved per-case on web from data the case page can reach; unused today (zero approved maps). |
| `groupInsurance`                | **Build PDF parity.** Same shape — one policy pick, already implemented once in `providerProfile.ts`.                        |
| `user`                          | **Build PDF parity.** Cheapest of all: five keys from the caller's own `profiles` row, no case scoping.                      |
| `payer`, `contract`, `mso`      | **Withdraw from the picker**, or mark unfillable. Unresolvable on both paths by design. Offering them is the defect.         |
| org contacts                    | **Decide, don't drift.** Web resolves them; the picker hides them. Either offer them and build PDF parity, or say why not.   |
| `system.today` (proposed)       | **Blocked until the above is settled** — D-DYN-4.                                                                            |

---

## Proposed build bites

Each is one reviewable change. **None is approved by this spike** — they are
the shape the work takes, for separate PM sign-off.

**Status:** 01, 06 and the `license.*` half of 05 are BUILT (see below). The
family-reach map they share lives in `src/lib/fillTokenReach.ts`; the license
selection rule in `src/lib/licensePick.ts`. 02, 03, 04 and the rest of 05
remain proposals.

### BITE-DYN-TOKEN-01 — honest sample fill _(do first)_

Stop `PayerFormFieldPanel`'s sample from resolving what a real case cannot.
Resolve sample values through the _same family set_ `buildProviderTokenValues`
reaches, and render an out-of-reach token as the gap it will really be.

- **Repos:** panel · **Risk:** low · **Depends on:** none
- **DoD:** the sample fill cannot claim support the case fill lacks (this is
  the DoD clause the spike's own definition of done names).
- **Non-goals:** changing the web dry run's mock profile, which is correct.
- **BUILT 2026-09-03.** `sampleValues` now mocks only `isPdfFillableToken`
  tokens. Out-of-reach tokens are **omitted, not blanked**, so they take the
  same path a real case gives them — `planPayerFormFill` classifies an absent
  value as `empty_token` and the existing UI already renders that as a gap.
  The sample-fill toast additionally counts them by name.

### BITE-DYN-TOKEN-02 — resolver-aware picker

Mark or filter tokens the active surface cannot resolve. The family→reach map
is static and derivable from `ENTITY_TOKEN_FAMILIES` plus the profile's `picks`
keys; no new query.

- **Repos:** panel · **Risk:** low · **Depends on:** none (parallel to 01)
- **DoD:** a trainer cannot map a payer-PDF field to an unreachable token
  without seeing that it will not fill.

### BITE-DYN-TOKEN-03 — parity contract test

One test asserting the reach of each surface per family, failing by **name**
when a family is offered but unreachable — the same pattern as the quick-card
catalog drift test.

- **Repos:** panel · **Risk:** low · **Depends on:** 01, 02
- **DoD:** adding a family to the catalog fails the suite until it is
  classified on both paths.

### BITE-DYN-TOKEN-04 — PDF resolver for `user.*`

Smallest real parity build, and the family with live web usage (6 maps).

- **Repos:** panel · **Risk:** low · **Depends on:** 03
- **Open question for the builder:** the case page has no caller-profile read
  today. Confirm the existing `/account` profile query can be reused under RLS
  rather than adding a frontend `/api` exception — **that exception is a stated
  non-goal.**

### BITE-DYN-TOKEN-05 — PDF resolver for `license.*` / `assignment.*` / `groupInsurance.*`

Three child-row picks. Split further if the selection rules (which license for
which state, which policy) do not port cleanly from `providerProfile.ts`.

- **Repos:** panel · **Risk:** medium — selection rules, not plumbing
- **D3 SETTLED 2026-09-03: `license.*` is canonical.** `providers.license_*`
  has no writer and is null for all 21 hosted providers; provider create and
  update write `state_licenses` rows. The four `provider.license*` tokens are
  withdrawn from the mapping pickers and the columns are documented deprecated
  in place — not dropped (additive-schema rule).
- **`license.*` PDF resolver BUILT 2026-09-03.** `pickLicenseForState`
  (`src/lib/licensePick.ts`) is now the ONE selection rule, shared by
  `providerProfile.ts` and the case page. The case names exactly one state —
  it is part of the 4-part case key — so the PDF pick is unambiguous where the
  web route has to ask via `?state=`. It never falls back: several licenses and
  no state resolves to null, because a plausible wrong license number on a
  payer application is worse than a blank.
- **`PDF_FILL_FAMILIES` must include `license`.** The sample fill reads that
  list via `isPdfFillableToken`. Leaving it at provider/group/facility after
  the resolver landed would teach trainers that `license.*` cannot fill when
  the case fill now can — the exact TOKEN-01 lie, reintroduced. Fixed
  2026-09-03 (cleanup pass).
- **Hosted data (2026-09-03):** three of the four broken `provider.license*`
  global maps were repointed to `license.*`. The fourth —
  `aetna_direct` `#medicalLicenseNumber` (`a1f760e6-…`), token
  `provider.licenseState` against a license-**number** label — was a second,
  separate mis-map. PM call: do not repoint to `license.state`. Reset to
  `proposed` / null token so UAT can remapping from scratch onto
  `license.licenseNumber`.
- **Still open:** `assignment.*` and `groupInsurance.*` PDF parity. Both are
  unused today (zero approved maps), so neither is urgent.

### BITE-DYN-TOKEN-06 — withdraw `payer.*` / `contract.*` / `mso.*`

- **Repos:** panel · **Risk:** low
- **PM decision (2026-09-03): WITHDRAW.** Not marked-but-visible — removed from
  both mapping pickers outright. Zero maps reference these families in any
  status, so nothing is orphaned.
- **Depends on:** nothing, once "withdraw" is the answer. The dependency on 02
  existed only for the "mark" option, which needed 02's presentation layer.
- **Scope note:** the withdrawal belongs in the mapping surfaces, **not** in
  `listTokenCatalog()`. That catalog has a third consumer — the SOP authoring
  picker — which already applies its own reachability filter
  (`filterAuthoringTokens` → `isResolvableToken`) and legitimately admits
  `mso.*`, because `buildSopTokenMap` passes an MSO row. Filtering the shared
  catalog would silently narrow SOP authoring.
- **BUILT 2026-09-03.** `filterMappingTokens` applied in `FormStepPanel` (web)
  and `PayerFormFieldPanel` (payer PDF). `listTokenCatalog()` is unchanged, so
  the SOP authoring picker keeps `mso.*`.

**No locked API contract has to widen for any of these.** Every one is
panel-internal: the PDF fill is a browser-side path that never crosses `/api`,
and the web profile response shape is unchanged. The extension needs no
coordinated change, and `src/shared/apiTypes.ts` is untouched.

---

## What DYN-TODAY-01 inherits

Once 01–03 land, `system.today` is a small, honest addition:

- it is the **first token with no source table** other than `user.*`, so 02's
  reach map needs a "computed" class rather than a table lookup;
- both surfaces compute it in the coordinator's browser at fill click
  (D-DYN-2), so it is the one family that is _trivially_ at parity;
- 03's contract test is what proves that claim instead of asserting it.

---

## Non-goals (restated)

Implementing parity, adding `system.today`, adding the `case.*` family, and a
frontend exception to call the PHI profile API. This document changes no code,
no schema, and no data.

---

## Appendix A — the queries

Read-only. Keys and counts only; no token _values_ and no PHI. Re-run before
quoting any number here in a build PR.

```sql
-- 1. Approved token usage by family and map type.
select
  coalesce(map_type, '(null)') as map_type, status, source,
  case
    when token is null or btrim(token) = '' then '(no token)'
    when position('.' in token) > 0 then split_part(token, '.', 1)
    else '(bare)'
  end as token_family,
  count(*) as maps, count(distinct token) as distinct_tokens
from portal_field_maps
group by 1,2,3,4
order by 1,2,3, maps desc;

-- 2. The exact approved tokens, web vs pdf.
select
  split_part(token, '.', 1) as family, token,
  count(*) filter (where map_type = 'web') as web_maps,
  count(*) filter (where map_type = 'pdf') as pdf_maps
from portal_field_maps
where status = 'approved' and source = 'token'
  and token is not null and btrim(token) <> ''
group by 1, 2
order by 1, 2;

-- 3. The offered catalog, sized per family.
with cat as (
  select * from jsonb_to_recordset(to_jsonb(get_sop_field_tokens()))
    as t("table" text, token text, "column" text)
)
select "table" as source_table, split_part(token, '.', 1) as family,
       count(*) as tokens_offered
from cat group by 1, 2 order by 3 desc, 1;
```

## Appendix B — code read

| Question                      | File                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| What is offered               | `src/services/tokenCatalog.ts`, `src/hooks/useMappingReview.ts`                      |
| Web resolution                | `src/services/providerProfile.ts`, `src/server/extensionRoutes.ts`                   |
| Web appends                   | `src/server/userTokens.ts`, `src/lib/orgContactTokens.ts`                            |
| PDF resolution                | `src/lib/pdfFill.ts:112`, `src/lib/entityTokens.ts`                                  |
| PDF token map is built here   | `src/routes/cases.$id.tsx:98`                                                        |
| PDF plan / gap classification | `src/lib/payerFormFill.ts`                                                           |
| The sample fill               | `src/components/templates/PayerFormFieldPanel.tsx:170`, `src/lib/mockFillProfile.ts` |
