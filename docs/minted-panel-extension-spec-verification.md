# Extension Build Spec — Verification and Execution Log

**Updated:** July 3, 2026
**Scope:** Records what was verified against the live Supabase project (`fkvuhfsqcmujywzgczmc`) and what has been executed from the spec (`minted-panel-extension-build-spec.md`, now v1.2).

## Executed 2026-07-03 (spec v1.2, milestone M-PDF infra)

- **Migration `20260703070000_portal_fill_infrastructure.sql` applied.** `portal_field_maps`, `provider_documents` (with `case_id` + `filled_form`), `fill_sessions` (append-only), `touches` constraints updated (`source` gains `'extension'`, `outcome` gains `'form_filled'`), buckets `provider-documents` and `form-templates` with storage policies. Note: the live database was missing `set_updated_at()` even though migration `20260623044419` defines it — the repo's migration history and the live DB have drifted (Lovable applies changes outside this file set). The new migration recreates the function defensively.
- **`resolve-fill` edge function deployed** (v1, ACTIVE, JWT required). The single token resolver: approved maps + 133-token vocabulary + defaulting rules + transforms → resolved field list.
- **`fill-pdf` edge function deployed** (v1, ACTIVE, JWT required). Calls `resolve-fill` over HTTP, fills AcroForm PDFs with pdf-lib, prepends a manual-fields cover sheet, stores output, logs fill_session + touch + audit.
- Function sources committed under `supabase/functions/`.

**Verification gap:** this sandbox's network policy blocks direct HTTPS to `*.supabase.co`, so the functions were not invoked end-to-end here (deploy-time bundling validates syntax only). First live test needs: a logged-in user, approved `map_type: 'pdf'` rows for a portal_key, and a blank PDF at `form-templates/{portal_key}.pdf`. Smoke test from the app console:

```js
const { data } = await supabase.functions.invoke('resolve-fill', {
  body: { caseId: '<case uuid>', portalKey: 'uhc_optum' },
});
```

## Verified facts (2026-07-03)

- **`touches.source` check constraint** (spec open question 4): existed with only `'manual'`/`'email_webhook'`; now includes `'extension'`. `touch_type` already allowed `'portal'`. `outcome` is NOT NULL, so `'form_filled'` was added for automated fills.
- **Token vocabulary:** `get_sop_field_tokens()` returns **133 tokens across 9 tables** (`contracts`, `facilities`, `group_insurance_policies`, `msos`, `payers`, `provider_facility_assignments`, `provider_groups`, `providers`, `state_licenses`). Spec v1.1 said 132; the implementation plan's 46 is badly stale. EXECUTE had been revoked from `authenticated` (migration `20260623044730`); the new migration re-grants it so the resolver can read the vocabulary under the caller's JWT.
- **No naming collisions:** `portal_field_maps`, `provider_documents`, `fill_sessions` did not exist before the migration.
- **`writeAudit` pattern** (`src/lib/audit.ts`): throws on insert failure, org from active-org store. The `fill-pdf` function mirrors it — any logging insert failure fails the request.
- **`group_insurance_policies.insurance_type`** is constrained to `'professional_liability'`/`'general_liability'`; the resolver picks `professional_liability` for malpractice tokens.
- **`.env` in this repo points at an abandoned Supabase project** (`isdygvnjpctvwthfgxcf`); the real client is hardcoded in `src/integrations/supabase/externalClient.ts` (`fkvuhfsqcmujywzgczmc`), consistent with AGENTS.md.

## Referenced documents still missing from version control

`uhc-optum-sop-field-guide-v2.md` and `minted-panel-customer-implementation-plan.md` are cited by the spec but not checked in anywhere reachable. The YAML seeder (M-PDF) is blocked on the field guide.

## Deliberately not done in this repo

- No extension scaffold — spec rule: new repo `minted-panel-extension` (M0, after M-PDF completes).
- No app UI changes (case-page fill-pdf button, Documents tab, extension touch pill, fill sheet) — section 10, sequenced via Lovable.
- No `portal_field_maps` seed rows — blocked on the Optum YAML + blank PDF; rows enter as `proposed` and require SS approval regardless.
