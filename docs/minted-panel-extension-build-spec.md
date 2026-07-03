# Minted Panel Chrome Extension — Build Spec v1.2
**Date:** July 3, 2026
**v1.2 changes:** Resequenced — PDF fill (old M2.5) ships first, before any extension code. Token resolution moved server-side into a single `resolve-fill` edge function shared by PDF fill, the extension, and the app; the extension no longer queries source tables. Dashboard `externally_connectable` handoff deferred to M4 — v1 context is the manual case picker. Added the fill-sheet bridge. Token vocabulary corrected to 133 tokens across 9 tables (live count). Section 6 data model marked APPLIED with as-built deltas.
**v1.1 change:** Field maps aligned to the pre-planned YAML schema (source types, hardcoded values, web/pdf map types). Added YAML seeder and PDF fill via edge function.
**Audience:** Claude Code / Cursor. This is a build spec, not a Lovable prompt.
**Repo:** Extension code goes in a new repo `minted-panel-extension`. Shared backend (migrations, edge functions) lives in this repo and the Supabase project.

---

## 1. What this is

A Chrome extension (Manifest V3) that auto-fills payer credentialing web forms and auto-attaches required documents (W9, COI, license copies) using provider data from the Minted Panel Supabase project — plus a server-side PDF fill pipeline that works with no extension installed.

**The workflow it serves:**
1. Sowmya opens a case in Minted Panel (e.g., Joe + BCBS KS).
2. The task drawer shows an SOP step with a portal link.
3. She clicks the link. A new tab opens on the payer form.
4. She picks the case in the extension side panel (one click; dashboard auto-handoff arrives in M4).
5. It fills every mapped field and attaches every mapped document.
6. Sowmya reviews, completes unmapped fields, and submits herself.

**Hard rule: the extension never submits a form. Fill and attach only. Human clicks submit.**

## 2. Goals and non-goals

**Goals**
- Fill web forms on payer portals using data already in Supabase.
- Fill AcroForm PDFs server-side, downloadable from the case page on any machine.
- Attach documents from Supabase Storage to file inputs.
- Zero re-typing of provider demographics, group info, or facility info.
- One resolver. Web fills, PDF fills, and any future fill sheet all consume the same `resolve-fill` edge function. No duplicated token logic to keep in sync.
- Every fill session logged back to the case as a touch.

**Non-goals (v1)**
- In-tab PDF filling. Chrome's built-in PDF viewer is closed to extensions. PDF fill happens server-side (section 8b).
- Auto-login to portals. Sowmya must be authenticated in the portal already.
- Auto-submit. Never.
- CAPTCHA handling. Human step.
- Portal status scraping (roadmap item #14, a different project).
- Dashboard-to-extension context handoff (moved to M4; the manual picker is the v1 path).

## 3. V1 scope and sequencing

Resequenced in v1.2: the PDF pipeline ships first because it needs no extension, reuses the already-mapped Optum YAML, and proves the two riskiest shared pieces (field-map schema, token resolver) before a line of extension code exists.

| Order | Milestone | Target | Status |
|---|---|---|---|
| 1 | M-PDF (was M2.5) | Section 6 migrations, `resolve-fill` + `fill-pdf` edge functions, Optum seed | Infra live as of Jul 3, 2026 — see section 11 |
| 2 | M0 | Extension shell: auth, side panel, manual case picker, `resolve-fill` client | |
| 3 | M1 | BCBS KS provider enrollment web form: fill only | |
| 4 | M2 | Attachments on the M1 form (W9, COI) | |
| 5 | M3 | CAQH ProView | |
| 6 | M4 | BCBS TX, Aetna web flows + field-map admin UI + dashboard handoff | |

**Optional bridge (any time after M-PDF):** a "fill sheet" panel on the case page — every `resolve-fill` value for the target portal with copy buttons, manual fields flagged with instructions. Small Lovable/app change reusing the deployed resolver; delivers most of the no-retyping value while the extension is being built.

**CAQH risk note:** CAQH ProView terms of service restrict automated access. Before M3 ships, get a read on ToS exposure. Mitigation built into the design: the extension acts only in Sowmya's authenticated session, at human speed, human submits. It is assistive fill, not a bot. Still, flag it.

## 4. Architecture

```
Supabase project fkvuhfsqcmujywzgczmc (this repo)
  supabase/migrations/20260703070000_portal_fill_infrastructure.sql
  supabase/functions/resolve-fill/    THE resolver: case + portal_key -> resolved fields
  supabase/functions/fill-pdf/        AcroForm fill; calls resolve-fill over HTTP

minted-panel-extension/ (new repo, M0+)
  manifest.json            MV3
  src/
    background/            service worker: case registry, resolve-fill + storage calls
    content/               injected per portal: DOM scan, fill, attach
    sidepanel/             React side panel: case picker, fill status, doc list
    lib/
      supabase.ts          supabase-js client, session persistence in chrome.storage
      resolveFillClient.ts thin fetch wrapper for the resolve-fill edge function
      attachEngine.ts      fetch from Storage -> File -> DataTransfer -> input
  shared/                  types generated from Supabase schema
```

**Key components**

- **`resolve-fill` edge function (deployed).** The single token resolver. Input `{ caseId, portalKey, pageStep?, mapType? }`, JWT auth, RLS applies. Loads approved `portal_field_maps`, resolves tokens against the 9 source tables using the `get_sop_field_tokens()` vocabulary (133 tokens), applies defaulting rules (provider phone → facility phone, provider email → group credentialing email) and transforms, and returns per-field `{ selector, value, resolution: filled|partial|manual|empty, notes }` plus a case summary. Everything that fills a form calls this; nothing else resolves tokens.
- **Service worker (background).** Holds the active-case registry: `{ tabId -> { caseId, providerId, orgId } }`. Fetches resolved fields from `resolve-fill` and documents from Storage. Content scripts never talk to Supabase and never see the whole provider record — only resolved values for the current step (this now falls out of the architecture instead of being a discipline rule).
- **Content script.** Injected on matched portal domains only. Scans the DOM for mapped fields, fills, dispatches `input`/`change` events, reports results. `MutationObserver` handles SPA wizards: re-scan when the DOM changes.
- **Side panel.** Chrome side panel API. Shows: case picker (searchable, open cases, current org), fill progress (`14 of 17 fields filled`), unmapped/manual fields with notes, attachable documents, and a "log touch" confirmation. Primary UI. No popup.

## 5. Context: how the extension knows the case

**V1: manual case picker in the side panel.** Sowmya picks the case; the registry entry is written for that tab. With one coordinator working one case at a time this costs roughly two clicks, and it means the extension is never useless without the dashboard.

**M4: `externally_connectable` handoff from the dashboard** (deferred from v1.1's M0). The task-drawer portal link calls `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'SET_ACTIVE_CASE', ... })` before `window.open`. Add it only if case-picking proves slow in practice.

Context expires when the tab closes or after 60 minutes idle. One tab, one case. No global "current provider" state that could bleed the wrong provider's data into a form.

## 6. Data model — APPLIED 2026-07-03

Migration `20260703070000_portal_fill_infrastructure.sql` (this repo) is live. All tables org-scoped with the standard RLS pattern (`user_org_ids()` / `user_role()`); `org_id` set in code, never from payload. As-built deltas from v1.1 are noted inline.

**`portal_field_maps`** — as specced in v1.1, plus DB-level integrity checks: `token` required for `token`/`manual_partial` sources, `hardcoded_value` required for `hardcoded`, `notes` required for `manual`/`manual_partial`. A NULL `org_id` row is a shared/global map. The resolver only executes `status: 'approved'` rows.

**`provider_documents`** — as specced, plus `case_id` (nullable, for `filled_form` outputs) and `filled_form` added to the `doc_type` list. At least one of `provider_id`/`group_id`/`case_id` must be set. Storage bucket `provider-documents` (private) is live; object paths are `{org_id}/...` and storage policies scope by that prefix. Remember: malpractice COI and W9 are group-level; licenses are provider-level.

**`fill_sessions`** — as specced, plus `fill_mode` (`web`|`pdf`). Append-only: INSERT and SELECT policies only.

**`touches`** — `touches_source_check` now allows `'extension'` (used by both the extension and `fill-pdf`; open question 4 resolved: the constraint existed) and `touches_outcome_check` now allows `'form_filled'`, because `outcome` is NOT NULL and nothing in the original list described "filled but not submitted."

**Buckets** — `provider-documents` (org-scoped) and `form-templates` (blank payer forms; org members read, specialists/admins manage) both live.

**Approval flow:** AI (or a recording session) writes rows as `proposed`. SS approves in an admin screen (M4) or via SQL until then. The resolver never runs a `proposed` map.

**YAML seeder:** each SOP field guide carries a machine-readable YAML block (see `uhc-optum-sop-field-guide-v2.md` — not yet version-controlled; check it in before seeding). Build `scripts/seed-from-yaml.ts` to parse those blocks into `portal_field_maps` rows with `status: 'proposed'`. Optum is fully mapped already and is the first PDF seed. AcroForm field names still need recording against the blank PDF.

## 7. Fill engine (extension, M1+)

1. Content script activates on `url_pattern` match; background calls `resolve-fill` for `portal_key` + current step and hands the content script the resolved field list. No token logic in the extension.
2. **Locator convention:** an unprefixed `selector` is a CSS selector; `label:` prefix means match by field label text (via `label[for]`, wrapping label, or aria-label) — used when maps are drafted before the live DOM is recorded. `selector_fallbacks` holds ordered alternates in the same syntax. Recording (via `scripts/record-form-fields.js` or M4 recording mode) upgrades `label:` selectors to concrete name/id CSS.
3. For each field, branch on `resolution`: `filled` fills; `manual` goes to the side panel manual list with its `notes`; `partial` fills the partial value and flags the field amber; `empty` is listed as missing data. Then: locate element (selector, then fallbacks), set value, dispatch `input` and `change` (and `blur` for validation-heavy forms). For `select`: match option by value, then by trimmed text. For React-controlled inputs: use the native value setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(...)`) before dispatching, or the framework swallows the change.
4. Highlight filled fields with a subtle outline (forest green `#1B4D3E`, 1px).
5. **SSN rule:** the platform stores last 4 only. If a form needs full SSN, the field appears in the manual list with the note "Full SSN from secure file. Never stored in Minted Panel." The extension never handles full SSNs. Non-negotiable.
6. MutationObserver debounced at 500ms triggers re-scan on wizard step changes. Never re-fill a field the user has edited (track filled values; if current value differs from what we set, leave it alone).

## 8. Attachment engine (extension, M2)

Unchanged from v1.1: side panel lists case documents matched to `field_type: 'file'` maps by `doc_type`; background fetches from Storage via signed URL (60s), content script builds a `File` → `DataTransfer` → `input.files` and dispatches `change`. Drag-drop widgets get synthetic `drop` events per-portal only when hit. If attachment fails, "Download to attach manually" — graceful degradation, never a dead end. Expired docs (past `expiration_date`) show a red warning and are never auto-attached.

## 8b. PDF fill — DEPLOYED 2026-07-03

Edge functions `resolve-fill` and `fill-pdf` are live on the project.

**Flow (as built)**
1. Trigger from the platform: "Generate filled PDF" button on the case page (app change, section 10). Works on any machine, no extension. The extension gains a convenience trigger later.
2. `fill-pdf` — input `{ caseId, portalKey }`, user JWT, RLS applies, no service role:
   - Calls `resolve-fill` over HTTP with the same JWT (`mapType: 'pdf'`) — the one-resolver rule.
   - Loads the blank PDF from `form-templates/{portal_key}.pdf`.
   - Fills AcroForm fields with `pdf-lib` (text, checkbox, radio group, dropdown; option match by exact then case-insensitive text). `manual` fields stay untouched; `partial` fields get the partial value.
   - Prepends a cover sheet listing every manual/partial/no-data field with its instruction.
   - Never flattens — fields stay correctable.
   - Uploads to `provider-documents/{org_id}/cases/{case_id}/`, inserts `provider_documents` (`doc_type: 'filled_form'`, `case_id` set), `fill_sessions` (`fill_mode: 'pdf'`), a `touches` row (`touch_type: 'portal'`, `outcome: 'form_filled'`, `source: 'extension'`), and an `audit_log` row. Any logging failure fails the request loudly (writeAudit pattern).
   - Returns `{ signedUrl, filePath, fieldsFilled, skipped, manualFields }`.

**Constraints**
- AcroForm PDFs only in v1. Flat/scanned PDFs need x/y placement — out of scope until a real form forces it (`pdf_x`, `pdf_y`, `pdf_page` columns then).

**Not yet verified end-to-end:** deployment compiled and is ACTIVE, but a live run needs (a) a logged-in user JWT, (b) approved `map_type: 'pdf'` rows for a portal_key, (c) the blank PDF at `form-templates/{portal_key}.pdf`. First real test = Optum seed + template upload, then the case-page button.

## 9. Auth and security

- Extension login = Supabase auth (email/password or magic link), same project. Session persisted in `chrome.storage.local` via a custom storage adapter for supabase-js.
- All data access rides existing RLS. No service role key anywhere in this pipeline — the edge functions use the caller's JWT. Anon/publishable key only.
- Org scoping identical to the app: active org membership, `org_id` filter on every query.
- Content scripts receive only resolved values for the current step (structural, via `resolve-fill`), never the whole provider record.
- Host permissions: enumerate exact portal domains in the manifest. No `<all_urls>`.
- No analytics, no third-party scripts. PHI stays between the portal tab, the extension, and Supabase.
- Every fill logs to `fill_sessions` + `touches` + `audit_log`; inserts throw on failure.
- `get_sop_field_tokens()` EXECUTE was re-granted to `authenticated` (it's column-name metadata, no data) so the resolver reads the vocabulary under the user's JWT.

## 10. Minted Panel app changes (separate, small, via Lovable)

One Lovable prompt covering, in priority order:
1. "Generate filled PDF" button on the case page calling `fill-pdf`, showing the manual-fields list and download link. (Unblocks M-PDF end-to-end.)
2. Documents tab on provider and group pages: upload/list/delete against `provider_documents` + the `provider-documents` bucket (path prefix `{org_id}/...`). Service layer + hooks + audit rows.
3. Case timeline renders `source: 'extension'` touches with a distinct pill (`outcome: 'form_filled'`).
4. Optional bridge: the fill-sheet panel (section 3).
5. M4, not now: task-drawer `chrome.runtime.sendMessage` handoff, feature-checked so the app works without the extension.

## 11. Milestones and done-when

**M-PDF — PDF fill first (in progress)**
- [x] Section 6 migrations applied (`20260703070000_portal_fill_infrastructure.sql`)
- [x] `provider-documents` + `form-templates` buckets live with policies
- [x] `resolve-fill` deployed (single resolver, JWT + RLS)
- [x] `fill-pdf` deployed (AcroForm fill, cover sheet, full logging)
- [ ] Optum YAML checked in and seeded to `portal_field_maps` as pdf rows (`status: 'proposed'`)
- [ ] Blank Optum PDF uploaded to `form-templates`, AcroForm field names recorded, rows approved
- [ ] Case page button (app change #1) generates a correct filled PDF for a real case; defaulting rules verified
- [ ] Cover sheet lists manual fields with instructions (SSN, Medicaid #, former name)
- [ ] Output visible in provider documents; fill session + touch on the case timeline

**M0 — Extension shell (est. 3-4 days, thinner than v1.1)**
- [ ] MV3 extension loads unpacked, side panel opens
- [ ] Supabase login works, session survives browser restart
- [ ] Manual case picker sets active case for the tab
- [ ] Side panel renders `resolve-fill` output for a chosen case + portal
- [ ] Wrong-org case is invisible (RLS check)

**M1 — BCBS KS fill (est. 1 week)**
- [x] Form URL confirmed and field maps drafted from the published 15-481 application (24 rows seeded as `proposed`, portal_key `bcbs_ks_enrollment`)
- [ ] JSF selectors recorded on the live form (`scripts/record-form-fields.js`) and maps approved
- [ ] All mapped text/select/radio/date fields fill correctly for a KFP provider
- [ ] Defaulting rules honored (facility phone/fax, group credentialing email)
- [ ] Unmapped fields listed in side panel with notes
- [ ] Fill session + touch logged; visible on the case timeline
- [ ] Full SSN field appears as manual with the secure-source note

**M2 — Attachments (est. 3-5 days)**
- [ ] KFP W9 and COI uploaded via the Documents tab
- [ ] Auto-attach works on a standard file input
- [ ] Manual-download fallback works
- [ ] Expired doc blocked with warning

**M3 — CAQH (est. 2-3 weeks)**
- [ ] ToS review done and accepted
- [ ] Step detection across the ProView wizard
- [ ] Fill works on at least the demographics, practice location, and disclosure pages
- [ ] Session-timeout recovery: re-scan and resume without data loss

**M4 — Generalize (est. 2 weeks)**
- [ ] BCBS TX and Aetna web flows mapped
- [ ] Admin screen in Minted Panel: view/approve/retire `proposed` field maps
- [ ] Recording mode: click a field on a portal, pick a token, row saved as `proposed`
- [ ] Dashboard `externally_connectable` handoff (from section 5)

## 12. Open questions

1. ~~Exact BCBS KS form URL?~~ Resolved: `https://provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm.faces` — the web version of the Provider Network Application (form 15-481, formerly Provider Network Enrollment). The `allUsers` path indicates a public form, not behind Availity; confirm on first load. M1 host permission: `provider.bcbsks.com`. Field maps are seeded as `proposed` (see `scripts/seeds/bcbs_ks_enrollment_field_maps.sql`); JSF DOM selectors still need recording via `scripts/record-form-fields.js`.
2. Full SSN handling long-term: stay manual forever, or a session-only vault that never touches Supabase? Recommend: manual forever.
3. Chrome Web Store listing (private/unlisted) vs. enterprise policy install for Sowmya's machine? Unlisted is simplest for v1.
4. ~~Does `touches.source` have a check constraint?~~ Resolved: yes, and it's updated — `'extension'` added, plus `'form_filled'` to the outcome constraint.
5. Carried from the Optum field guide: should "Former Last Name" and "Individual Medicaid #" become tracked provider fields, or stay `manual` forever? Staying manual is fine for v1.
6. Stale reference: `minted-panel-customer-implementation-plan.md` says 46 tokens. Live count is 133 (was 132 when v1.1 was drafted). Fix on next plan update.
7. `uhc-optum-sop-field-guide-v2.md` isn't version-controlled anywhere reachable. Check it in (here or the extension repo) before building the YAML seeder.

---

**Build order:** M-PDF remaining items (seed + template + app button) → M0 extension scaffold in the new repo → M1 onward. App-side changes (section 10) run in Lovable.
