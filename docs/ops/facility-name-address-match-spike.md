# Spike — `facility_name` accepts a facility name or a street address

**Status:** decision-ready. This spike changes no product code and no schema.
**Date:** 2026-09-21
**Triggered by:** BEST Physical Therapy provider roster upload. Every data row
was rejected on `facility_name` because the sheet carries street addresses and
the scan only accepts the facility's exact name.

**Sources:** panel `main` @ `cce36e0`. Hosted project `fkvuhfsqcmujywzgczmc`,
org `BEST Physical Therapy LLC` (`5b5ee10f-e464-4d6b-8c7b-27b04e59c038`),
read-only. The roster and the error report are the two files attached to the
request (39 data rows, 39 `facility_name` errors).

---

## Verdict

**Build it.** Keep the column name `facility_name`. Treat the cell as a
locator: exact facility name, or a street address that resolves to exactly one
facility in the org. Address is the fallback, and only a single hit is
accepted.

Replayed against the live BEST facilities, all **22 distinct addresses / 39
rows resolve to exactly one facility**. Nothing in the file is ambiguous, and
nothing misses. The facilities already exist; this upload is an assignment,
not a create.

The match has to land in **both** resolvers. The upload scan is what blocked
this file. The preview/commit resolver still looks up the name on its own, so
fixing only the scan would unblock the file and then tell the coordinator the
location was not found.

No migration, no `/api` change, no new template column. The header gate stays
exact.

---

## What failed on this file

`PROVIDER_DESCRIPTOR.contextScan` (`src/lib/importSections.ts`) compares
`facility_name` to `facility.name` with trim + lowercase. A miss is a row
error:

> Unknown facility — copy the exact name from the reference sheet

That runs before staging. All 39 rows died there, so nothing reached preview
or commit. The error report is rows 2–40, column `facility_name`, that same
reason.

The cell values are full addresses, for example
`4801 Hargrove Road, Suite 100, Raleigh, NC 27616`. The reference sheet the
helper text points at (`providerImportReference`) lists facility **names**
only (`BEST Physical Therapy - Hargrove`), which this roster does not have.

Name match stays the first check, and it stays exact. A partial name
(`Hargrove`) still fails. The comment on the scan context — never
type-and-hope matching — still holds for names.

---

## Replay against live facilities

Org facilities: 28 active rows. The roster uses 22 of them. Group TIN
`851502637` is on two groups; Hargrove is the only roster location on the dba
group. Every other roster location is on `BEST Physical Therapy, LLC`.

| Roster cell | Resolved facility |
| --- | --- |
| 4801 Hargrove Road, Suite 100, Raleigh, NC 27616 | BEST Physical Therapy - Hargrove (dba group) |
| 100 Connemara Drive, Suite 110, Cary, NC 27519 | BEST Physical Therapy - Connemara |
| 280 Towerview Court, Cary, NC 27513 | BEST Physical Therapy - Towerview |
| 1008 Big Oak Court, Suite A, Knightdale, NC 27545 | BEST Physical Therapy - Knightdale |
| 9101 Leesville Rd STE 129, Raleigh, NC 27613 | BEST Physical Therapy - Leesville Rd |
| 11694 US-70 Business W, Clayton NC, 27520 | BEST Physical Therapy - Clayton |
| 4550 Fayetteville Road, Raeford, NC 28376 | BEST Physical Therapy - Raeford |
| 2307 N College Road, Wilmington, NC 28405 | BEST Physical Therapy - Wilmington |
| 275 Convention Dr, Cary, NC 27511 | BEST Physical Therapy - Convention |
| 1400 Timber Drive East, Garner NC 27529 | BEST Physical Therapy - Garner |
| 210 Owen Dr, Fayetteville, NC 28304 | BEST Physical Therapy - Fayetteville |
| 607 Mills Park Dr, Cary, NC 27519 | BEST Physical Therapy - Cary |
| 105 W North Carolina 54 #271, Durham, NC 27713 | BEST Physical Therapy - Durham |
| 19 Gladys Drive, Greenville, SC 29607 | BEST Physical Therapy - Greenville |
| 1726 Eagan Rd, Suite 101, Madison, WI 53704 | BEST Physical Therapy - Madison |
| 2920 Hardrock Rd, Fitchburg, WI 53719 | BEST Physical Therapy - Fitchburg |
| 1240 Hover St #200, Longmont, CO 80501 | BEST Physical Therapy - Longmont |
| 5904 Prairie Schooner Dr, Colorado Springs, CO 80923 | BEST Physical Therapy - Colorado Springs |
| 12951 Barker Cypress Rd, Cypress, TX 77429 | BEST Physical Therapy - Cypress |
| 9930 Gaston Rd, Katy, TX 77494 | BEST Physical Therapy - Katy |
| 13900 SW Meridian St, Beaverton, OR 97005 | BEST Physical Therapy - Beaverton |
| 4623 Enterprise Way, Caldwell, ID 83605 | BEST Physical Therapy - VS Caldwell |

Shapes in this file that a strict "same string as street, city, state zip"
compare would drop, and the rule below still takes:

- Suite glued to the street line (`STE 129`, `#271`, `#200`) rather than a
  separate comma piece.
- Missing comma between city and state (`Clayton NC,`, `Garner NC 27529`).
- `Rd` / `Dr` / `St` against the stored `Road` / `Drive` / `Street` (the file
  happens to agree with the database; the rule still expands suffixes).

Checked non-matches: `Nope Clinic` and `Hargrove` do not resolve. An unknown
street in a known ZIP does not resolve. `Rd` vs `Road` on Hargrove does
resolve. Omitting the suite on a street that exists once (Hargrove) still
resolves.

---

## Match rule

One pure function, used by the provider scan. Inputs: the cell, and the org
facility list the scan already loads (`id`, `name`, `street`, `suite`, `city`,
`state`, `zip`). `getFacilities` already selects `*`, so this is a wider map
at the two call sites (`providers.index.tsx`, `ProviderRosterSection.tsx`),
not a new query.

1. **Name.** Trim, case-insensitive equality on `name`. One hit wins, same as
   today. Several hits: row error (today `find` keeps the first; names in this
   org are unique, and a collision should not guess).
2. **Address, only if the name missed and the cell contains a 5-digit ZIP**
   (the last one, so a ZIP+4 still counts). No ZIP means this is a name, and
   the existing unknown-facility error stands. That keeps `Nope Clinic` from
   being parsed as an address.
3. **A facility is a street hit when** its ZIP5 equals that ZIP, its street
   token phrase occurs contiguously in the cell, and the token after the
   phrase is the city, the state, the ZIP, a suite word (`suite`, `ste`,
   `unit`, `apt`, `apartment`), or the suite unit. Normalization on both
   sides: lowercase, drop periods and commas, turn `#` into a space, collapse
   whitespace, expand `st/rd/dr/ave/blvd/ln/ct/hwy/pkwy/cir/pl/ter/trl`.
   Hyphenated tokens stay intact (`US-70`).
4. **One street hit** stamps `facility_id`. Suite disagreement does not reject
   it — the street is unique, and a wrong or missing suite is still that
   building.
5. **Several street hits** (two clinics on the same street and ZIP): look only
   at the tokens between the street phrase and the city/state/ZIP, drop the
   suite words, and keep the facility whose suite unit equals that remainder.
   Zero or several left: row error, do not guess. Comparing the suite unit to
   the whole cell is wrong — street number `100` would satisfy suite `100`.

Copy:

- No hit: `Unknown facility — use the exact name from the reference sheet, or the location's street address`
- Several hits: `Ambiguous facility — this address matches more than one location; use the exact name from the reference sheet`

Scope is the **whole org**, the same list name matching uses. Do not restrict
to the row's group first. Hargrove belongs to the dba group, and this file's
TIN resolves to the other group (see below); a group-scoped match would still
reject the three Hargrove rows. Two groups sharing one street is already a
supported facility-import case — org-wide uniqueness plus the ambiguous error
covers it.

Out of scope for the matcher: spelled-out state names, a city with no ZIP, PO
boxes, and fuzzy names.

---

## Both resolvers

| Path | Today | After |
| --- | --- | --- |
| `contextScan` in `src/lib/importSections.ts` | Name equality. Miss blocks the row. Stamps `facility_id`. | Calls the locator. Still the only hard gate. |
| `resolveFacility` in `src/lib/importDedupe.ts` | Name equality again. Miss is a soft note and **no** `facilityIds` on the commit plan. | If `mapped.facility_id` is set, use that row. The scan already decided. |

`applyProviderRelationships` (`src/services/importRuns.ts`) already attaches
from the stamped `facility_id` after `commit_import_run`. The RPC plan's
`facility_ids` come from `resolveFacility`. Today a successful **name** match
writes the assignment twice; `ignoreDuplicates` on `(provider_id, facility_id)`
makes the second insert a no-op. An address match that only updates the scan
would leave the preview note "Facility … not found — no facility assignment
will be created" while the post-commit pass still inserted it. The preview
has to agree with the stamp.

`DedupeFacilityRecord` can stay `{ id, name }`. The address fields are only
needed at scan time.

---

## Template and reference sheet

Do not add a column to the provider template. `facility_name` already exists,
the header gate is exact, and this file is already on that template.

Do update the provider helper text so it says the cell accepts the exact name
**or** the location's street address, and that the first facility on the file
is still the primary.

Do add the address onto `providerImportReference` (street, city, state, ZIP —
suite when present). The sheet is a download beside the template, not an
upload, so a new column there does not trip the header gate. Coordinators who
have addresses can copy one; coordinators who have names keep copying the name.

---

## Adjacent: this file's group TIN matches two groups

Not part of the address change, and not a reason to hold it. Recorded so the
re-upload is not surprising.

The sheet's group name is `B.E.S.T. Physical Therapy`. Neither live group is
named that. TIN `85-1502637` matches both:

- `BEST Physical Therapy, LLC` (`ebfa7e6f-6f7a-46a7-9abe-e114508065fa`) — 26 of the 28 facilities, including every roster location except Hargrove
- `BEST Physical Therapy, LLC (dba BEST Health Wellness Performance)` (`ff1358ce-dd0a-4244-9193-cb8f7b695d12`) — Hargrove only

`resolveGroup` returns the **first** TIN hit and no note. `getProviderGroups`
orders by name, so the preview plan attaches every row to `BEST Physical Therapy, LLC`.
`applyProviderRelationships` builds `groupByTin` from an **unordered** select,
so a duplicate TIN keeps whichever row arrives last. Those two paths can
disagree.

Address matching still assigns Hargrove to the three Hargrove providers
(Marc Douek, Megan Grable, Carlie Lenox). Their **group** assignment follows
the TIN rule above, which may not be the dba group that owns that location.
A later bite can fail a row closed when one TIN hits two groups and the name
does not break the tie. Doing that in this bite would leave the file blocked.

---

## Build bite

Pure locator + tests in `src/lib/` (the BEST shapes above, plus: suffix
expansion, missing suite on a unique street, same street+ZIP disambiguated by
suite, same street+ZIP with no suite → ambiguous, suite unit equal to the
street number must not count, prefix street `100 Main St` vs `100 Main St Annex`
does not cross-match, exact name still wins over a ZIP-shaped coincidence).

Wire it through `contextScan` and `resolveFacility`. Widen the facility objects
on `ProviderRelationshipScanContext` and the two scan-context builders. Update
helper text, the reference CSV, `docs/wiki/providers.md` (the "copy
`facility_name`" sentence), and the existing relationship-column tests.

No schema, no grants, no isolation-gate change, no extension contract.
