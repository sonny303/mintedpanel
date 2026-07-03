# Extension Build Spec v1.1 — Verification Against This Repo and Database

**Date:** July 3, 2026
**Scope:** The build spec (`minted-panel-extension-build-spec-v1.1.md`) targets a new repo, `minted-panel-extension`. Per the spec, nothing is built inside this project until section 6 is approved and M0 lands in the extension repo. This note records what was verified against the live Supabase project (`fkvuhfsqcmujywzgczmc`) and this codebase so the extension work starts from checked facts.

## Open question 4 — `touches.source` check constraint: ANSWERED, yes

`touches_source_check` exists and currently allows only `'manual'` and `'email_webhook'`:

```
CHECK ((source = ANY (ARRAY['manual'::text, 'email_webhook'::text])))
```

The section 6 migration must drop and recreate this constraint with `'extension'` added before the extension can log touches. `touches_touch_type_check` already permits `'portal'`, so no change is needed there.

## Token vocabulary — 133 tokens, not 132

Live count from `get_sop_field_tokens()` as of July 3, 2026: **133 tokens across 9 tables** (`contracts`, `facilities`, `group_insurance_policies`, `msos`, `payers`, `provider_facility_assignments`, `provider_groups`, `providers`, `state_licenses`). The spec header says 132 — off by one, likely a token added after the spec was drafted. The 9-table claim holds. Update the count on the next spec revision, along with the stale 46-token reference in `minted-panel-customer-implementation-plan.md` (spec open question 6).

Note for the extension's `tokenResolver.ts`: the function returns a single `jsonb` array of `{token, table, column}` objects, and `EXECUTE` is revoked from `PUBLIC`, `anon`, and `authenticated` (see migration `20260623044730`). The extension cannot call it at runtime with the publishable key; treat it as the design-time vocabulary source and resolve tokens against the base tables directly, or grant execute deliberately as part of the section 6 migration.

## Proposed tables — no naming collisions

None of `portal_field_maps`, `provider_documents`, or `fill_sessions` exist in the `public` schema. Section 6 migrations are purely additive, consistent with the database rules in `AGENTS.md`.

## `writeAudit` pattern — confirmed

`src/lib/audit.ts` exports `writeAudit`, which throws on insert failure and pulls `org_id` from the active-org auth store. The spec's section 9 requirement (audit every fill session, throw on failure) matches the existing pattern the extension should replicate.

## Referenced documents not in this repo

`uhc-optum-sop-field-guide-v2.md` and `minted-panel-customer-implementation-plan.md` are cited by the spec but are not version-controlled here. The YAML seeder (`scripts/seed-from-yaml.ts`, extension repo) needs the field-guide files checked in somewhere reachable before M2.5.

## What is deliberately NOT done in this repo

- No extension scaffold (M0) — spec hard rule: new repo `minted-panel-extension`.
- No section 6 migrations — gated on SS approval of the data model.
- No section 10 app changes (task-drawer handoff, documents tab, extension touch pill) — spec sequences these after M0 proves the handoff, via a separate Lovable prompt.
