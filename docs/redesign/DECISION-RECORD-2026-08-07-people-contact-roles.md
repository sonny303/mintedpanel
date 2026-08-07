# Decision Record — People Contact Roles & Contact Tokens (2026-08-07)

PM decisions, Sowmya, 2026-08-07. Scope: activate the three reserved
`party_role_types` roles — `billing_contact`, `contracting_signer`,
`credentialing_contact` — and make contact fields resolvable as tokens so they
can be pulled into payer-form mapping.

This record is the input to a future build epic. Nothing here is built yet.

## The problem

The three roles have existed as `is_active = false` rows in `party_role_types`
since E0.1 (`20260709120000_party_model_foundation.sql`). `PartiesManager`
already renders them disabled ("coming soon") straight from the live governed
list, and the `reject_inactive_role_assignment` trigger is what makes them
un-assignable. Flipping `is_active` is one service-role `UPDATE`.

That flip alone is not enough for two reasons:

1. **Cardinality.** The assignment unique key is
   `(org_id, party_id, role_key, scope_type, scope_id)`, so N people may hold
   `billing_contact` in one org. A token needs exactly one answer.
2. **No contact field is tokenized anywhere today.** `get_sop_field_tokens()`
   sweeps nine tables; `parties` is not one of them. So contacts are absent
   from the SOP authoring picker, the provider-profile fill payload, the
   extension quick-card catalog, and portal field maps.

## Decisions

1. **Many holders per role, one default.** Additive `is_default boolean` on
   `party_role_assignments` + partial unique on `(org_id, role_key)
WHERE is_default`. Tokens resolve the default. This mirrors `payer_contacts`
   (`uq_payer_contacts_default_purpose`) rather than inventing a second shape.
2. **Widen `scope_type` now, use `'org'` for now.** The CHECK is
   `('org','facility','case')` — notably missing `'group'`, which is the grain
   a credentialing contact or contract signer actually belongs to in a
   multi-TIN org. Widen the CHECK to include `'group'` in this migration even
   though the UI keeps writing `'org'`: it is additive and free now, and
   retrofitting a grain after the tokens are a live wire contract means
   re-resolving every trained mapping.
3. **`title` is a real column** — additive. A signature block needs
   "Managing Partner", and `parties` has no title today.
4. **Never required at intake.** These roles are added through People, not
   `create_organization`. The 2026-08-07 hotfix removed exactly this class of
   forced default (the auto-created Zeb sales rep); do not reintroduce one.
5. **No removal guard.** Consistent with that same hotfix, which deleted the
   "can't remove the only sales rep" rule. Warn in the UI, never block.
6. **Split the name.** `parties.name` is a single `text NOT NULL` and
   `ContactFields` collects one "Full name". Add `first_name`/`last_name`,
   backfill by splitting on the last space, and change the form to two inputs.
   A heuristic split at fill time is strictly worse than one at capture time,
   where a human can correct it. `name` stays as the display value.
7. **Also add `fax`, `phone_extension`, `title`.** Payer contact blocks ask for
   these; adding them now is additive and avoids a second migration after the
   token family is a live contract.
8. **Org-scoped identity, enforced.** Add `org_id NOT NULL` to `parties`,
   backfill from the single assignment, and rewrite the four RLS policies to
   key on membership directly. **This retires F0.3.4** (the cross-org "Add
   existing person" reuse pool) — cross-org identity is bad practice: one
   shared row means editing a contact's phone edits it for every org that
   assigned them. The `created_by` RLS disjunct exists to cover
   create-before-assign; with `org_id` on the insert, membership covers it.
   Live data at decision time: **1 org, 2 parties, 2 assignments, 0 parties
   shared across orgs** — the backfill is trivial and this is the cheapest this
   change will ever be.
9. **Code-owned token family, not the RPC.** `get_sop_field_tokens()` derives
   tokens from `information_schema.columns`, which would yield `party.email` —
   useless, because the point is _whose_ email. The family is inherently
   ROLE × FIELD and has no schema derivation, so it is appended in code the way
   the `{{user.*}}` family is (`src/server/userTokens.ts` precedent). The RPC
   stays honestly uncurated.
10. **Flat camelCase families**: `billingContact.*`, `credentialingContact.*`,
    `contractingSigner.*` — matching the existing `groupInsurance.*` style.
    Token keys join `portal_field_maps` ↔ profile ↔ quick cards by literal
    string match, so this naming is effectively irreversible once trained
    mappings exist. Pick it once.
11. **Resolves at profile time.** Unlike `payer.*` / `mso.*` / `contract.*`
    (which `providerProfile.ts` returns null with "resolve at fill time from
    the case context"), org contacts resolve on
    `GET /api/providers/:id/profile` — the org comes from the guard ctx. If
    decision 2 is ever exercised and contacts move to group grain, they inherit
    the profile's existing group/facility selection, including its "never
    guess" rule when several are in play.
12. **Fill-time primary; not in SOP bodies.** A token in a SOP body resolves at
    case creation and is baked into `tasks.sop_content` — it would not update
    when the contact changes. Contacts therefore do NOT go into
    `sopResolver.buildTokenMap`, and so do not appear in the authoring picker
    (which is gated by `resolvableTokenKeys()`).
13. **SOP email recipients and people contacts stay separate.**
    `emailValuedTokenKeys()` remains `["provider.email"]`. Consequence to know:
    a `draft_email` step cannot address the credentialing contact. Contacts are
    values typed into forms, not people the system emails. Reversing this later
    is a one-line change plus a `sopPublishLint` pass.
14. **Quick-card guardrails reviewed** — see below.

### Composite tokens (follow-on from decision 6)

Splitting the name makes "one form field, two stored fields" real. The fix is a
**server-derived composite token**, not mapping-time concatenation:
ship `billingContact.fullName` alongside `firstName`/`lastName`, computed at
resolution. Precedent: `buildTokenMap` already emits `facility.address` as
street + city + state + zip joined.

Mapping-time concatenation was rejected as the default because
`portal_field_maps.token` is a single `string | null` per row — arbitrary
combination would need a new template column plus fill-engine changes in BOTH
repos and a trainer UI that can compose. Revisit only if a real payer form
needs a combination the composites do not cover.

## Resulting schema shape (one additive migration)

- `party_role_types`: `is_active = true` for the three roles.
- `party_role_assignments`: `+ is_default boolean`, partial unique
  `(org_id, role_key) WHERE is_default`; `scope_type` CHECK widened with
  `'group'`.
- `parties`: `+ org_id NOT NULL` (backfilled, RLS rewritten),
  `+ first_name`, `+ last_name` (backfilled by last-space split),
  `+ title`, `+ fax`, `+ phone_extension`.

## Token family spec

Three families × the field set, code-owned, emitted by the profile endpoint:

```
billingContact.{firstName,lastName,fullName,title,email,phoneOffice,
                phoneExtension,phoneMobile,fax,addressLine1,addressLine2,
                city,state,postalCode,country}
credentialingContact.{…same}
contractingSigner.{…same}
```

Resolution: the `is_default` holder of that role in the caller's org; absent
holder resolves null with an honest `unresolved` reason, never a guess.

## Decision 14 — guardrail review findings

**Keep as-is:** `quickCardCatalog.test.ts`. It reconstructs the token set from
the checked-in `types.ts` and fails **by name** on any unclassified new column.
It is the only reason a deny-list is safe there, and it is what will force the
contact family to be consciously classified. Do not delete it to make a build
pass.

**Two exclusions look wrong** (each a one-line move from
`QUICK_CARD_EXCLUDED_FIELDS` to offered):

- `groupInsurance.coverageLevel` — excluded 2026-07-29 as "selects which policy
  resolves, never a value a form asks for", but malpractice sections do ask
  primary vs secondary.
- `provider.terminatedDate` — excluded as internal lifecycle, yet termination
  and roster-removal forms ask for an end date.

**Unrelated debt, logged not fixed:** the SOP authoring picker is gated by
`resolvableTokenKeys()`, so it offers only the ~19 keys `buildTokenMap` happens
to resolve, against 132 in the catalog. The gate is correct in mechanism (an
unresolvable token is silently dropped from `dataFields` at resolution); the
fix is widening the map, not removing the gate. Does not block this work —
decision 12 keeps contacts out of SOP bodies.

## Explicitly out of scope

- Mapping-time multi-token concatenation (composites cover the need).
- Contacts as SOP draft-email recipients (decision 13).
- Contacts in SOP bodies / the authoring picker (decision 12).
- Per-group contact assignment in the UI (decision 2 prepares the schema only).
- Widening `buildTokenMap` to close the ~19-of-132 picker gap.
