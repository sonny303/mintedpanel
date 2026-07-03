# Minted Panel Chrome Extension — Build Spec v1.1

**Date:** July 2, 2026
**v1.1 change:** Field maps aligned to the pre-planned YAML schema (source types, hardcoded values, web/pdf map types). Added YAML seeder and PDF fill via edge function (M2.5). Token vocabulary confirmed at 132 tokens across 9 tables.
**Audience:** Claude Code / Cursor. This is a build spec, not a Lovable prompt.
**Repo:** New repo `minted-panel-extension`. Do not build this inside the Lovable project.

---

## 1. What this is

A Chrome extension (Manifest V3) that auto-fills payer credentialing web forms and auto-attaches required documents (W9, COI, license copies) using provider data from the Minted Panel Supabase project.

**The workflow it serves:**

1. Sowmya opens a case in Minted Panel (e.g., Joe + BCBS KS).
2. The task drawer shows an SOP step with a portal link.
3. She clicks the link. A new tab opens on the payer form.
4. The extension already knows which case the tab belongs to.
5. It fills every mapped field and attaches every mapped document.
6. Sowmya reviews, completes unmapped fields, and submits herself.

**Hard rule: the extension never submits a form. Fill and attach only. Human clicks submit.**

## 2. Goals and non-goals

**Goals**

- Fill web forms on payer portals using data already in Supabase.
- Attach documents from Supabase Storage to file inputs.
- Zero re-typing of provider demographics, group info, or facility info.
- Every fill session logged back to the case as a touch.

**Non-goals (v1)**

- In-tab PDF filling. Chrome's built-in PDF viewer is closed to extensions. No content script can touch it. PDF fill happens server-side instead (section 8b), triggered from the platform or the extension side panel.
- Auto-login to portals. Sowmya must be authenticated in the portal already.
- Auto-submit. Never.
- CAPTCHA handling. Human step.
- Portal status scraping (that is roadmap item #14, a different project).

## 3. V1 scope and sequencing

| Milestone | Target                                             | Why this order                                                |
| --------- | -------------------------------------------------- | ------------------------------------------------------------- |
| M0        | Extension shell, auth, context handoff             | Foundation                                                    |
| M1        | BCBS KS provider enrollment web form: fill only    | Simplest real target, standard inputs                         |
| M2        | Attachments on the M1 form (W9, COI)               | Proves the DataTransfer approach                              |
| M2.5      | PDF fill edge function (Optum/Aetna AcroForm PDFs) | Server-side, low risk, reuses maps. Seeded from existing YAML |
| M3        | CAQH ProView                                       | Highest value, hardest. Multi-page SPA, MFA, timeouts         |
| M4        | BCBS TX, Aetna web flows + field-map admin UI      | Generalize                                                    |

**CAQH risk note:** CAQH ProView terms of service restrict automated access. Before M3 ships, get a read on ToS exposure. Mitigation built into the design: the extension acts only in Sowmya's authenticated session, at human speed, human submits. It is assistive fill, not a bot. Still, flag it.

## 4. Architecture

```
minted-panel-extension/
  manifest.json            MV3
  src/
    background/            service worker: context registry, Supabase calls
    content/               injected per portal: DOM scan, fill, attach
    sidepanel/             React side panel: case context, fill status, doc list
    lib/
      supabase.ts          supabase-js client, session persistence in chrome.storage
      fieldMapEngine.ts    resolves field maps -> selectors -> values
      tokenResolver.ts     token string -> value, via get_sop_field_tokens vocabulary
      attachEngine.ts      fetch from Storage -> File -> DataTransfer -> input
  shared/                  types generated from Supabase schema
```

**Key components**

- **Service worker (background).** Holds the active-case registry: `{ tabId -> { caseId, providerId, orgId } }`. Listens for messages from the web app (context handoff) and from content scripts (data requests). All Supabase reads happen here, not in content scripts.
- **Content script.** Injected on matched portal domains only. Scans the DOM for mapped fields, requests resolved values from the background, fills, dispatches `input`/`change` events, reports results. Uses a `MutationObserver` to handle SPA wizards: re-scan when the DOM changes (new wizard step).
- **Side panel.** Chrome side panel API. Shows: active case (provider, payer, state), fill progress (`14 of 17 fields filled`), unmapped fields list, attachable documents with attach buttons, and a "log touch" confirmation. This is the primary UI. No popup.

## 5. Context handoff (how the extension knows the case)

Two mechanisms, both implemented. Primary is (a); (b) is the fallback.

**(a) `externally_connectable` message from the dashboard.**

- `manifest.json` declares `externally_connectable.matches` for the app domain(s).
- Minted Panel change (one small Lovable prompt, out of this repo's scope): when a coordinator clicks a portal link in the task drawer, before `window.open`, the app calls `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'SET_ACTIVE_CASE', caseId, providerId, orgId, portalUrl })`.
- Background stores it and associates the next tab opened to `portalUrl`'s origin with that case.

**(b) Manual case picker in the side panel.**

- If no handoff message arrived (Sowmya opened the portal directly), the side panel shows a searchable case list (open cases, current org). She picks the case. Same registry entry gets written.
- This also covers the day the handoff breaks. Never let the extension be useless without the dashboard.

Context expires when the tab closes or after 60 minutes idle. One tab, one case. No global "current provider" state that could bleed the wrong provider's data into a form.

## 6. Data model (Supabase migrations, `apply_migration`)

All tables org-scoped with the standard RLS pattern. `org_id` set in code, never from payload.

**`portal_field_maps`**

| column             | type    | notes                                                                                                                              |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| id                 | uuid pk |                                                                                                                                    |
| org_id             | uuid    | RLS scope. Maps can be org-specific; a null org_id row is a shared/global map                                                      |
| portal_key         | text    | e.g. `bcbs_ks_enrollment`, `caqh_proview`                                                                                          |
| url_pattern        | text    | match pattern for content script activation and step detection                                                                     |
| page_step          | text    | wizard step identifier, nullable for single-page forms                                                                             |
| map_type           | text    | `web` or `pdf`. Web maps run in the extension; pdf maps run in the fill edge function                                              |
| selector           | text    | web: CSS selector. pdf: AcroForm field name                                                                                        |
| selector_fallbacks | jsonb   | web only. Ordered alternates: label text match, name attr, aria-label                                                              |
| source             | text    | `token`, `manual`, `manual_partial`, `hardcoded`. Matches the YAML schema in the SOP field guides                                  |
| token              | text    | for `token`/`manual_partial` sources. e.g. `{{provider.npi}}` — same vocabulary as `get_sop_field_tokens()` (132 tokens, 9 tables) |
| hardcoded_value    | text    | for `hardcoded` source only. e.g. specialty = `PT`                                                                                 |
| transform          | text    | nullable: `date_mmddyyyy`, `phone_digits`, `state_abbrev`, `uppercase`                                                             |
| field_type         | text    | `text`, `select`, `radio`, `checkbox`, `date`, `file`                                                                              |
| notes              | text    | coordinator-facing instruction. Required when source is `manual` or `manual_partial` (mirrors the YAML `instruction` field)        |
| status             | text    | `proposed`, `approved`, `retired`. Extension only executes `approved`                                                              |

**Source semantics (from the pre-planned YAML schema):**

- `token`: resolve and fill.
- `hardcoded`: fill `hardcoded_value` as-is.
- `manual`: never fill. Surface in the side panel manual list with `notes`.
- `manual_partial`: fill the token portion (e.g. SSN last 4) and flag as needs-completion with `notes`.

**YAML seeder:** each SOP field guide carries a machine-readable YAML block (see `uhc-optum-sop-field-guide-v2.md`). Build a one-off script (`scripts/seed-from-yaml.ts`) that parses those blocks into `portal_field_maps` rows with `status: 'proposed'`. Optum's form is fully mapped already; it becomes the first PDF seed. Selectors/field names still need recording per form, but source, token, and instruction data carry over.

**Approval flow:** AI (or a recording session) writes rows as `proposed`. SS approves in an admin screen (M4) or via SQL until then. The extension never runs a `proposed` map. This is the guardrail from the original architecture plan.

**`provider_documents`**

| column          | type        | notes                                                                                 |
| --------------- | ----------- | ------------------------------------------------------------------------------------- |
| id              | uuid pk     |                                                                                       |
| org_id          | uuid        |                                                                                       |
| provider_id     | uuid        | nullable: group-level docs (COI, W9) have null provider_id and set group_id           |
| group_id        | uuid        | nullable                                                                              |
| doc_type        | text        | `w9`, `coi`, `state_license`, `dea`, `diploma`, `board_cert`, `voided_check`, `other` |
| file_path       | text        | Supabase Storage path                                                                 |
| file_name       | text        | original filename                                                                     |
| effective_date  | date        | nullable                                                                              |
| expiration_date | date        | nullable. Enables expirables alerting later (roadmap G-item)                          |
| uploaded_by     | uuid        |                                                                                       |
| created_at      | timestamptz |                                                                                       |

Storage bucket: `provider-documents`, private, RLS on storage.objects mirroring table policy. Remember: malpractice COI is group-level. W9 is group-level. Licenses are provider-level.

**`fill_sessions`** (append-only, like touches)

| column                       | type        | notes                                                 |
| ---------------------------- | ----------- | ----------------------------------------------------- |
| id                           | uuid pk     |                                                       |
| org_id, case_id, provider_id | uuid        |                                                       |
| portal_key                   | text        |                                                       |
| started_at, completed_at     | timestamptz |                                                       |
| fields_filled                | int         |                                                       |
| fields_skipped               | jsonb       | list of tokens/selectors that failed or were unmapped |
| docs_attached                | jsonb       | doc_type + file_name list                             |
| performed_by                 | uuid        |                                                       |

On session complete, the background also inserts a row into `touches` (`touch_type: 'portal'`, `source: 'extension'` — add `'extension'` to the source enum/check if constrained) so the case timeline shows the work.

## 7. Fill engine

1. Content script activates on `url_pattern` match, requests approved maps for `portal_key` + current step from background.
2. Background resolves tokens: one query per source table (provider, provider_groups, facilities, contracts, state_licenses), scoped by org_id. Reuse the token vocabulary from `get_sop_field_tokens()` so SOP templates and the extension speak the same language. Apply the defaulting rules from the SOP field guide: provider phone/fax/email default to facility/group values.
3. For each map row, branch on `source`: `token` and `hardcoded` fill; `manual` goes straight to the side panel manual list; `manual_partial` fills the partial token and flags the field amber. Then: locate element (selector, then fallbacks), set value, dispatch `input` and `change` (and `blur` for validation-heavy forms). For `select`: match option by value, then by trimmed text. For React-controlled inputs: use the native value setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(...)`) before dispatching, or the framework swallows the change.
4. Highlight filled fields with a subtle outline (forest green `#1B4D3E`, 1px). List unfilled/manual fields in the side panel with their `notes` hints.
5. **SSN rule:** the platform stores last 4 only. If a form needs full SSN, the field appears in the manual list with the note "Full SSN from secure file. Never stored in Minted Panel." The extension never handles full SSNs. Non-negotiable.
6. MutationObserver debounced at 500ms triggers re-scan on wizard step changes. Never re-fill a field the user has edited (track filled values; if current value differs from what we set, leave it alone).

## 8. Attachment engine

1. Side panel lists documents for the active case's provider + group, matched to the form's `field_type: 'file'` maps by `doc_type`.
2. On attach (auto for mapped file inputs, or via side panel button):
   - Background fetches the file from Storage (signed URL, 60s expiry), returns bytes to content script.
   - Content script: `new File([bytes], fileName, { type: mimeType })`, `DataTransfer.items.add(file)`, assign `dataTransfer.files` to `input.files`, dispatch `change`.
3. For drag-drop upload widgets: dispatch synthetic `drop` event carrying the DataTransfer. Implement per-portal only when hit; do not build generically up front.
4. If attachment fails (custom uploader we can't drive), side panel shows a "Download to attach manually" button that saves the file locally so Sowmya can attach it by hand. Graceful degradation, never a dead end.
5. Expired docs (past `expiration_date`) show a red warning and are never auto-attached.

## 8b. PDF fill (edge function, not in-tab)

Chrome's native PDF viewer is closed to extensions. So PDF fill runs server-side and reuses the same maps.

**Flow**

1. Trigger from either place:
   - Platform (primary): "Generate filled PDF" button on the case page, next to the SOP task. Works on any machine, no extension needed.
   - Extension (convenience): side panel detects a PDF tab or PDF link on a portal page and offers "Fill this PDF for {provider}."
2. Edge function `fill-pdf` (deploy via `deploy_edge_function`):
   - Input: `{ caseId, portal_key }`. Auth: user JWT, RLS applies. No service role for data reads.
   - Loads the blank PDF template from a `form-templates` Storage bucket (uploaded once per payer form).
   - Loads approved `map_type: 'pdf'` rows for `portal_key`.
   - Resolves tokens with the same resolver logic (shared module or duplicated resolver kept in sync with the extension's).
   - Fills AcroForm fields with `pdf-lib`. `manual` fields stay blank. `manual_partial` fields get the partial value.
   - Returns the filled PDF plus a cover sheet page listing every manual field and its instruction, so Sowmya knows exactly what to complete by hand.
3. Output saved to `provider_documents` (`doc_type: 'filled_form'`, linked to the case in a `case_id` column, nullable) and offered as a download. Fill session + touch logged, same as web fills.

**Constraints**

- AcroForm PDFs only in v1 (real fillable fields). Optum and most Aetna/BCBS forms qualify.
- Flat/scanned PDFs need x/y coordinate placement. Out of scope until a real form forces it. If it comes up, add `pdf_x`, `pdf_y`, `pdf_page` columns.
- Never flatten the PDF on output. Sowmya may need to correct fields.

## 9. Auth and security

- Extension login = Supabase auth (email/password or magic link), same project `fkvuhfsqcmujywzgczmc`. Session persisted in `chrome.storage.local` via a custom storage adapter for supabase-js.
- All data access rides existing RLS. The extension gets no service role key, ever. Anon/publishable key only.
- Org scoping identical to the app: active org membership, `org_id` filter on every query.
- Content scripts receive only the resolved values for the current step, never the whole provider record.
- Host permissions: enumerate exact portal domains in the manifest. No `<all_urls>`.
- No analytics, no third-party scripts. PHI stays between the portal tab, the extension, and Supabase.
- Log every fill session to `fill_sessions` and `audit_log` (`writeAudit` pattern: throw on failure, per KTLO #2).

## 10. Minted Panel app changes (separate, small, via Lovable)

Out of this repo. One Lovable prompt covering:

1. Task drawer portal links call `chrome.runtime.sendMessage(EXTENSION_ID, ...)` before opening the tab. Wrapped in a feature check (`chrome?.runtime?.sendMessage` exists) so the app works without the extension.
2. Documents tab on provider and group pages: upload/list/delete against `provider_documents` + Storage bucket. Service layer + hooks + audit rows, per the post-KTLO architecture.
3. Case timeline renders `source: 'extension'` touches with a distinct pill.

## 11. Milestones and done-when

**M0 — Shell (est. 3-5 days)**

- [ ] MV3 extension loads unpacked, side panel opens
- [ ] Supabase login works, session survives browser restart
- [ ] Dashboard link click sets active case (verify in side panel)
- [ ] Manual case picker works with no handoff
- [ ] Wrong-org case is invisible (RLS check)

**M1 — BCBS KS fill (est. 1 week)**

- [ ] Field maps recorded and approved for the BCBS KS enrollment form
- [ ] All mapped text/select/radio/date fields fill correctly for a KFP provider
- [ ] Defaulting rules honored (facility phone/fax, group credentialing email)
- [ ] Unmapped fields listed in side panel with notes
- [ ] Fill session + touch logged; visible on the case timeline
- [ ] Full SSN field appears as manual with the secure-source note

**M2 — Attachments (est. 3-5 days)**

- [ ] `provider_documents` table + bucket live, KFP W9 and COI uploaded
- [ ] Auto-attach works on a standard file input
- [ ] Manual-download fallback works
- [ ] Expired doc blocked with warning

**M2.5 — PDF fill (est. 1 week)**

- [ ] `fill-pdf` edge function deployed, blank Optum PDF in `form-templates` bucket
- [ ] Optum YAML seeded to `portal_field_maps` as pdf rows, field names recorded, approved
- [ ] Filled PDF downloads with correct values, defaulting rules honored
- [ ] Cover sheet lists manual fields with instructions (SSN, Medicaid #, former name)
- [ ] Output saved to `provider_documents` and touch logged
- [ ] Case page button works with no extension installed

**M3 — CAQH (est. 2-3 weeks)**

- [ ] ToS review done and accepted
- [ ] Step detection across the ProView wizard
- [ ] Fill works on at least the demographics, practice location, and disclosure pages
- [ ] Session-timeout recovery: re-scan and resume without data loss

**M4 — Generalize (est. 2 weeks)**

- [ ] BCBS TX and Aetna web flows mapped
- [ ] Admin screen in Minted Panel: view/approve/retire `proposed` field maps
- [ ] Recording mode: click a field on a portal, pick a token, row saved as `proposed`

## 12. Open questions

1. Exact BCBS KS form URL and whether it sits behind Availity login or is a public web form. Determines M1 host permissions.
2. Full SSN handling long-term: stay manual forever, or a session-only vault that never touches Supabase? Recommend: manual forever.
3. Chrome Web Store listing (private/unlisted) vs. enterprise policy install for Sowmya's machine? Unlisted is simplest for v1.
4. Does `touches.source` have a check constraint that needs `'extension'` added? Verify `information_schema` before the migration.
5. Carried from the Optum field guide: should "Former Last Name" and "Individual Medicaid #" become tracked provider fields, or stay `manual` forever? Staying manual is fine for v1.
6. Stale reference: `minted-panel-customer-implementation-plan.md` says 46 tokens. Actual count is 132. Fix on next plan update.

---

**Build order for Claude Code:** M0 scaffold first. Migrations via Supabase MCP `apply_migration` after SS approval of section 6. App-side changes (section 10) run in Lovable, sequenced after M0 proves the handoff.
