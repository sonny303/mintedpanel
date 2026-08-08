# Shared training walkthrough — new form for a sample payer

End-to-end example of training a **brand-new shared (org-free) form** using the three `/api` shared-training routes. Every request and response below matches the live wire shape.

Companion Postman folder: **Walkthrough · Train Acme form** in
[`minted-panel-api.postman_collection.json`](./minted-panel-api.postman_collection.json).

---

## Sample payer & form

| Field | Value |
|---|---|
| Payer display name | Acme Health Insurance |
| Portal key | `acme_provider_enrollment` |
| Form URL | `https://providers.acmehealth.example/enroll/application` |
| Pages in capture | 2 — `Provider identity`, `Practice location` |
| Fields captured | 9 (shape only — no values leave the browser) |

This is a **fiction** for the walkthrough. Registering the portal on hosted/prod is a
separate webapp/SQL step (see Step 0).

---

## Auth rule for every shared call

```
Authorization: Bearer <user JWT>
Content-Type: application/json   (POST only)
```

**Do not send `x-org-id`.** Shared routes run on `authenticateUser()` (JWT only).
Training has no org; the extension never sends an org header in Train mode
(`shouldSendOrgHeader` in `minted-extension` → `src/shared/panelMode.ts`).

Envelope on every response:

```json
{ "data": …, "error": null, "meta": … }
```

Failures: `data` is `null`, `error` is a **string** (not an object), HTTP status set.

---

## Sequence overview

```
[Webapp / SQL]  Register global portal row          ← NOT an /api route
       │
       ▼
① GET  /api/shared-portals                          ← find Acme in the list
② GET  /api/shared-field-maps?portal_key=…          ← empty (new form)
③ POST /api/shared-field-maps  × N                  ← propose each captured field
④ GET  /api/shared-field-maps?portal_key=…          ← confirm rows landed
⑤ POST same selector again                          ← idempotent re-capture (decision kept)
⑥ [Webapp] Field Registry: map token / fixed / human ← NOT an /api route from the extension
```

Approval and token-binding happen in the panel Field Registry UI (RPCs
`train_global_field_map` / `update_shared_field_registry`). The extension **only
proposes** shape rows.

**Wire quirks to know before you run this:**

| Fact | Detail |
|---|---|
| Propose response | Always `{ data: { map: PortalFieldMap } }` — unwrap `data.map` |
| HTTP status on propose | Always **200** (create and re-capture look the same at the status line; identity is the same `map.id`) |
| Org propose contrast | `POST /api/portal-field-maps` returns 201 on first sighting; shared does not |
| Unknown `portal_key` | Propose does **not** 404 — there is no FK to `portals`. Register first so the trainer can *find* the form; orphan map rows are still possible if you skip Step 0 |

---

## Step 0 — Register the shared portal (prerequisite, not `/api`)

There is **no** `POST /api/shared-portals`. Shared portals are written through the
webapp’s global authoring path (`upsert_global_portal` RPC) or a service-role
insert. Until a global `portals` row exists with this `portal_key`, Step 1 will
not list Acme and the Train-forms picker has nothing to select.

Minimal row shape (illustrative SQL — do not run against prod without an operator):

```sql
INSERT INTO portals (
  id, org_id, portal_key, name, form_url, payer_id, is_verified
) VALUES (
  gen_random_uuid(),
  NULL,                                    -- shared tier
  'acme_provider_enrollment',
  'Acme provider enrollment',
  'https://providers.acmehealth.example/enroll/application',
  '<acme-payer-uuid>',                     -- optional FK to payers
  false
);
```

Or, in the app: Payer Setup → Templates → register portal on a global SOP’s
`online_form` step (E6.5 / E6.9 path).

---

## Step 1 — List shared portals

### Request

```http
GET /api/shared-portals HTTP/1.1
Host: mintedpanel.vercel.app
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

No query params. No `x-org-id`.

### Response `200`

```json
{
  "data": [
    {
      "id": "a1000000-0000-4000-8000-000000000001",
      "orgId": null,
      "portalKey": "acme_provider_enrollment",
      "name": "Acme provider enrollment",
      "formUrl": "https://providers.acmehealth.example/enroll/application",
      "payerId": "b2000000-0000-4000-8000-000000000002",
      "payerName": "Acme Health Insurance",
      "isVerified": false,
      "createdAt": "2026-08-08T18:00:00.000Z",
      "updatedAt": "2026-08-08T18:00:00.000Z"
    },
    {
      "id": "00000000-0000-4000-8000-00000000bcbs",
      "orgId": null,
      "portalKey": "bcbs_ks_enrollment",
      "name": "BCBS KS network enrollment",
      "formUrl": "https://provider.bcbsks.com/…/NetworkEnrollmentForm.faces",
      "payerId": null,
      "payerName": "Blue Cross and Blue Shield of Kansas",
      "isVerified": false,
      "createdAt": "2026-07-28T12:00:00.000Z",
      "updatedAt": "2026-07-28T12:00:00.000Z"
    }
  ],
  "error": null,
  "meta": {
    "total": 2
  }
}
```

**What the extension does with this:** populates the Train-mode payer/form
picker. Recognition later uses the same rows via `GET /api/portals` (org+global)
when working cases; training deliberately uses this shared-only list.

---

## Step 2 — Read field maps for the new form (expect empty)

### Request

```http
GET /api/shared-field-maps?portal_key=acme_provider_enrollment HTTP/1.1
Host: mintedpanel.vercel.app
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

`portal_key` is recommended. Server normalizes it (trim + lowercase). Omitting it
returns **all** shared maps across every form (still `org_id IS NULL` only).

### Response `200` — brand-new form

```json
{
  "data": [],
  "error": null,
  "meta": {
    "total": 0
  }
}
```

Trainer UI shows: *new form, 0 fields captured*.

---

## Step 3 — Capture page 1 and propose fields

Trainer is on page **Provider identity**. Content script scans the DOM
(shape only: selectors, labels, types — **never values**). Side panel sends
`SEND_CAPTURE`; the background worker calls `POST /api/shared-field-maps` once
per field.

### Request — field 1 of 4

```http
POST /api/shared-field-maps HTTP/1.1
Host: mintedpanel.vercel.app
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

```json
{
  "portal_key": "acme_provider_enrollment",
  "selector": "#providerFirstName",
  "field_label": "First Name",
  "form_section": "Provider Information",
  "page_step": "Provider identity",
  "field_type": "text",
  "sort_order": 0
}
```

### Response `200`

```json
{
  "data": {
    "map": {
      "id": "c3000000-0000-4000-8000-000000000010",
      "orgId": null,
      "portalKey": "acme_provider_enrollment",
      "selector": "#providerFirstName",
      "token": null,
      "fieldLabel": "First Name",
      "formSection": "Provider Information",
      "pageStep": "Provider identity",
      "fieldType": "text",
      "status": "proposed",
      "source": "manual",
      "displayLabel": null,
      "section": null,
      "sortOrder": 0,
      "createdAt": "2026-08-08T18:05:00.000Z",
      "updatedAt": "2026-08-08T18:05:00.000Z"
    }
  },
  "error": null,
  "meta": null
}
```

Extension client unwraps `data.map` (`proposeSharedFieldMap` in
`minted-extension` → `src/background/api.ts`).

Server / RPC force, whatever the body said:

| Forced | Value |
|---|---|
| `org_id` | `null` (shared) |
| `status` | `proposed` |
| `source` | `manual` |
| `token` | `null` |
| `map_type` | `web` |
| `notes` | default `"Captured for the shared form library"` if omitted |

### Remaining page-1 POSTs (same pattern)

**Last name** (`sort_order: 1`):

```json
{
  "portal_key": "acme_provider_enrollment",
  "selector": "#providerLastName",
  "field_label": "Last Name",
  "form_section": "Provider Information",
  "page_step": "Provider identity",
  "field_type": "text",
  "sort_order": 1
}
```

**NPI** (`sort_order: 2`):

```json
{
  "portal_key": "acme_provider_enrollment",
  "selector": "#npi",
  "field_label": "National Provider Identifier",
  "form_section": "Provider Information",
  "page_step": "Provider identity",
  "field_type": "text",
  "sort_order": 2
}
```

**Specialty** (`sort_order: 3`):

```json
{
  "portal_key": "acme_provider_enrollment",
  "selector": "select#specialty",
  "field_label": "Specialty",
  "form_section": "Provider Information",
  "page_step": "Provider identity",
  "field_type": "select",
  "sort_order": 3
}
```

Each returns `200` with `{ data: { map: { …, orgId: null, status: "proposed", token: null } } }`.

### Error — missing portal_key or selector

```json
{ "selector": "#x" }
```

```json
{
  "data": null,
  "error": "portal_key is required",
  "meta": null
}
```

```json
{
  "data": null,
  "error": "selector is required",
  "meta": null
}
```

### Error — bad field_type

```json
{
  "data": null,
  "error": "field_type must be one of text, select, radio, checkbox, date, file",
  "meta": null
}
```

Allowed `field_type` values: `text` \| `select` \| `radio` \| `checkbox` \| `date` \| `file` (default `text`).

---

## Step 4 — Capture page 2

Trainer advances to **Practice location**. Capture merges **per page**
(`mergePageCapture`) so page-1 rows are not treated as removed.

### POSTs (`sort_order` continues from page 1)

**Practice name** (`sort_order: 4`):

```json
{
  "portal_key": "acme_provider_enrollment",
  "selector": "#practiceName",
  "field_label": "Practice / Group Name",
  "form_section": "Practice Location",
  "page_step": "Practice location",
  "field_type": "text",
  "sort_order": 4
}
```

**Street** (`5`):

```json
{
  "portal_key": "acme_provider_enrollment",
  "selector": "#addrStreet",
  "field_label": "Street Address",
  "form_section": "Practice Location",
  "page_step": "Practice location",
  "field_type": "text",
  "sort_order": 5
}
```

**City** (`6`):

```json
{
  "portal_key": "acme_provider_enrollment",
  "selector": "#addrCity",
  "field_label": "City",
  "form_section": "Practice Location",
  "page_step": "Practice location",
  "field_type": "text",
  "sort_order": 6
}
```

**State** (`7`):

```json
{
  "portal_key": "acme_provider_enrollment",
  "selector": "#addrState",
  "field_label": "State",
  "form_section": "Practice Location",
  "page_step": "Practice location",
  "field_type": "select",
  "sort_order": 7
}
```

**ZIP** (`8`):

```json
{
  "portal_key": "acme_provider_enrollment",
  "selector": "#addrZip",
  "field_label": "ZIP Code",
  "form_section": "Practice Location",
  "page_step": "Practice location",
  "field_type": "text",
  "sort_order": 8
}
```

All five → `200` with the same forced shared/proposed shape.

---

## Step 5 — Re-read the registry (confirm coverage)

### Request

```http
GET /api/shared-field-maps?portal_key=acme_provider_enrollment HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Response `200` (9 rows, ordered by `sort_order`)

```json
{
  "data": [
    {
      "id": "c3000000-0000-4000-8000-000000000010",
      "orgId": null,
      "portalKey": "acme_provider_enrollment",
      "selector": "#providerFirstName",
      "token": null,
      "fieldLabel": "First Name",
      "formSection": "Provider Information",
      "pageStep": "Provider identity",
      "fieldType": "text",
      "status": "proposed",
      "source": "manual",
      "displayLabel": null,
      "section": null,
      "sortOrder": 0,
      "createdAt": "2026-08-08T18:05:00.000Z",
      "updatedAt": "2026-08-08T18:05:00.000Z"
    },
    {
      "id": "c3000000-0000-4000-8000-000000000011",
      "orgId": null,
      "portalKey": "acme_provider_enrollment",
      "selector": "#providerLastName",
      "token": null,
      "fieldLabel": "Last Name",
      "formSection": "Provider Information",
      "pageStep": "Provider identity",
      "fieldType": "text",
      "status": "proposed",
      "source": "manual",
      "displayLabel": null,
      "section": null,
      "sortOrder": 1,
      "createdAt": "2026-08-08T18:05:01.000Z",
      "updatedAt": "2026-08-08T18:05:01.000Z"
    },
    {
      "id": "c3000000-0000-4000-8000-000000000012",
      "orgId": null,
      "portalKey": "acme_provider_enrollment",
      "selector": "#npi",
      "token": null,
      "fieldLabel": "National Provider Identifier",
      "pageStep": "Provider identity",
      "sortOrder": 2,
      "status": "proposed",
      "source": "manual"
    },
    {
      "id": "c3000000-0000-4000-8000-000000000013",
      "orgId": null,
      "portalKey": "acme_provider_enrollment",
      "selector": "select#specialty",
      "token": null,
      "fieldLabel": "Specialty",
      "pageStep": "Provider identity",
      "sortOrder": 3,
      "status": "proposed",
      "source": "manual"
    },
    {
      "id": "c3000000-0000-4000-8000-000000000014",
      "orgId": null,
      "portalKey": "acme_provider_enrollment",
      "selector": "#practiceName",
      "token": null,
      "fieldLabel": "Practice / Group Name",
      "pageStep": "Practice location",
      "sortOrder": 4,
      "status": "proposed",
      "source": "manual"
    },
    {
      "id": "c3000000-0000-4000-8000-000000000015",
      "orgId": null,
      "portalKey": "acme_provider_enrollment",
      "selector": "#addrStreet",
      "token": null,
      "sortOrder": 5,
      "pageStep": "Practice location",
      "status": "proposed",
      "source": "manual"
    },
    {
      "id": "c3000000-0000-4000-8000-000000000016",
      "orgId": null,
      "portalKey": "acme_provider_enrollment",
      "selector": "#addrCity",
      "token": null,
      "sortOrder": 6,
      "pageStep": "Practice location",
      "status": "proposed",
      "source": "manual"
    },
    {
      "id": "c3000000-0000-4000-8000-000000000017",
      "orgId": null,
      "portalKey": "acme_provider_enrollment",
      "selector": "#addrState",
      "token": null,
      "sortOrder": 7,
      "pageStep": "Practice location",
      "status": "proposed",
      "source": "manual"
    },
    {
      "id": "c3000000-0000-4000-8000-000000000018",
      "orgId": null,
      "portalKey": "acme_provider_enrollment",
      "selector": "#addrZip",
      "token": null,
      "fieldLabel": "ZIP Code",
      "pageStep": "Practice location",
      "sortOrder": 8,
      "status": "proposed",
      "source": "manual"
    }
  ],
  "error": null,
  "meta": {
    "total": 9
  }
}
```

Coverage at this point (Field Registry classification): **9 undecided / 0 mapped**.
Nothing autofills yet — fill only uses `approved` maps with a token or hardcoded value.

---

## Step 6 — Re-capture the same page (idempotent drift repair)

Trainer re-runs capture on page 1. Same selectors → **no second row**, decision
untouched (still `proposed` / `token: null`, or still `approved` + token if an
admin had mapped it in the interim).

### Request (identical to first propose)

```http
POST /api/shared-field-maps HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

```json
{
  "portal_key": "acme_provider_enrollment",
  "selector": "#providerFirstName",
  "field_label": "First Name",
  "form_section": "Provider Information",
  "page_step": "Provider identity",
  "field_type": "text",
  "sort_order": 0
}
```

### Response `200` — same `map.id`

```json
{
  "data": {
    "map": {
      "id": "c3000000-0000-4000-8000-000000000010",
      "orgId": null,
      "portalKey": "acme_provider_enrollment",
      "selector": "#providerFirstName",
      "token": null,
      "fieldLabel": "First Name",
      "formSection": "Provider Information",
      "pageStep": "Provider identity",
      "fieldType": "text",
      "status": "proposed",
      "source": "manual",
      "displayLabel": null,
      "section": null,
      "sortOrder": 0,
      "createdAt": "2026-08-08T18:05:00.000Z",
      "updatedAt": "2026-08-08T18:05:00.000Z"
    }
  },
  "error": null,
  "meta": null
}
```

Idempotency key: `(portal_key, selector)` on the shared tier
(`org_id IS NULL`). RPC: `ON CONFLICT DO NOTHING` + re-read
(`propose_shared_field_map`). Unique index: `uq_portal_field_maps_shared_selector`.

A **new** selector on re-capture still inserts a row — that is how DOM drift
adds fields without wiping prior decisions.

---

## Step 7 — Map fields in the webapp (after propose)

Not an extension `/api` call. Admin opens the SOP editor Field Registry for
`acme_provider_enrollment` and decides each row, e.g.:

| Selector | Decision | Token / value |
|---|---|---|
| `#providerFirstName` | Map to token | `provider.firstName` |
| `#providerLastName` | Map to token | `provider.lastName` |
| `#npi` | Map to token | `provider.npi` |
| `select#specialty` | Map to token | `provider.specialty` |
| `#practiceName` | Map to token | `group.legalName` |
| `#addrStreet` | Map to token | `facility.street` |
| `#addrCity` | Map to token | `facility.city` |
| `#addrState` | Map to token | `facility.state` |
| `#addrZip` | Map to token | `facility.zip` |

After that, a later `GET /api/shared-field-maps?portal_key=acme_provider_enrollment`
returns the same nine rows with `status: "approved"`, `source` reflecting the
decision, and `token` populated — and **Work cases** fill will use them
(`GET /api/portal-field-maps` includes these global rows; only `approved` maps fill).

---

## Propose body reference

| Field | Required | Notes |
|---|---|---|
| `portal_key` | yes | Normalized bare/lowercase |
| `selector` | yes | CSS selector from the capture scan |
| `field_label` | no | Payer’s visible label (normalized at write) |
| `form_section` | no | Captured heading / section |
| `page_step` | no | Page name from `derivePageStep` (heading → URL tail → sequence) |
| `field_type` | no | One of `text\|select\|radio\|checkbox\|date\|file`; default `text` |
| `sort_order` | no | DOM order; must be a number when present |

**Never send:** field values, tokens, `status`, `source`, `org_id`,
`hardcoded_value`. The server ignores or overrides them.

---

## curl recipe (after Step 0)

```bash
export API=https://mintedpanel.vercel.app
export JWT='<paste user access_token>'
export KEY=acme_provider_enrollment

# 1. List shared portals — find Acme
curl -sS "$API/api/shared-portals" \
  -H "Authorization: Bearer $JWT" | jq '.data[] | {portalKey,name,payerName}'

# 2. Empty maps
curl -sS "$API/api/shared-field-maps?portal_key=$KEY" \
  -H "Authorization: Bearer $JWT" | jq .

# 3. Propose one field → unwrap .data.map
curl -sS -X POST "$API/api/shared-field-maps" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"portal_key\": \"$KEY\",
    \"selector\": \"#providerFirstName\",
    \"field_label\": \"First Name\",
    \"form_section\": \"Provider Information\",
    \"page_step\": \"Provider identity\",
    \"field_type\": \"text\",
    \"sort_order\": 0
  }" | jq '.data.map | {id, orgId, status, token, selector}'

# 4. Re-propose — same id, still 200
curl -sS -X POST "$API/api/shared-field-maps" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"portal_key\": \"$KEY\",
    \"selector\": \"#providerFirstName\",
    \"field_label\": \"First Name\",
    \"form_section\": \"Provider Information\",
    \"page_step\": \"Provider identity\",
    \"field_type\": \"text\",
    \"sort_order\": 0
  }" -w '\nHTTP %{http_code}\n' | jq '.data.map.id'
```

---

## How this maps to the extension

| UI action | Message | Worker API |
|---|---|---|
| Open Train forms | mode → `train` | `shouldSendOrgHeader` → never send `x-org-id` |
| Load form picker | — | `GET /api/shared-portals` |
| Recognize current tab | — | same registry + `matchPortalByUrl` |
| Load coverage | — | `GET /api/shared-field-maps?portal_key=` |
| Capture page → Send | `START_CAPTURE` / `SEND_CAPTURE` | `POST /api/shared-field-maps` per field |
| Work cases fill | mode → `case` | `GET /api/portal-field-maps` (org+global approved) |

Code pointers:

- Panel: `src/server/extensionRoutes.ts` (`handleListShared*`, `handleProposeSharedFieldMap`)
- Panel: `src/services/sharedFieldMaps.ts`, `src/services/portals.ts` (`listSharedPortals`)
- Extension: `src/background/api.ts` (`listSharedPortals`, `listSharedFieldMaps`, `proposeSharedFieldMap`)
- Extension: `src/shared/panelMode.ts` (`shouldSendOrgHeader`)
- Extension: `src/background/index.ts` (`SEND_CAPTURE` → shared vs org propose by mode)

---

## Isolation note

Gate assertions **22 / 22b / 23** + leak mode `sharedtier`: these routes may
return **only** `org_id IS NULL` rows. An org-scoped `portal_field_maps` row
must never appear on `GET /api/shared-field-maps`.
