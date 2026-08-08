# Minted Panel `/api` — Postman library

Importable collection of every HTTP route under `/api/*`, with sample request bodies and example responses.

## Import

1. Postman → **Import** → select both files in this folder:
   - `minted-panel-api.postman_collection.json`
   - `minted-panel-api.postman_environment.json`
2. Select the **Minted Panel API** environment.
3. Paste a Supabase user JWT into `jwt`.
4. Call **GET my orgs**, copy an `orgId` into the environment (multi-org only).
5. Fill `providerId` / `caseId` / etc. from real responses as you explore.

## Folder map

| Folder | Auth | Who uses it |
|--------|------|-------------|
| 0. Health | public | ops |
| 1. Me | user JWT | extension |
| 2. Shared training tier | user JWT | extension (Train forms) |
| Walkthrough · Train Acme form | user JWT | **run in order** — new-form example |
| 3. Providers | org | extension (+ Chunk 3 pilot) |
| 4. Portals & field maps | org | extension (Work cases) |
| 5. Cases & touches | org | extension |
| 6. Fill events & task steps | org | extension |
| 7. Next best action | org | extension |
| 8. Documents | org | **webapp only** |

## Shared training walkthrough

Full call sequence + payloads for training a **new sample payer form**
(`acme_provider_enrollment`):

→ [`shared-training-walkthrough.md`](./shared-training-walkthrough.md)

Set env `acmePortalKey` (default `acme_provider_enrollment`), paste `jwt`, then
run the Postman **Walkthrough · Train Acme form** folder top-to-bottom.

**Prerequisite:** a global `portals` row must already exist (webapp
`upsert_global_portal` / SQL) — there is no `POST /api/shared-portals`.

## Envelope (every response)

```json
{
  "data": {},
  "error": null,
  "meta": { "total": 1, "page": 1, "pageSize": 100 }
}
```

## Auth headers

| Mode | Headers |
|------|---------|
| User-scoped (`/api/me/*`, `/api/shared-*`) | `Authorization: Bearer <jwt>` only |
| Org-scoped | Bearer + `x-org-id` when the user has multiple orgs |
| Public | none |

## Contract notes worth remembering

- **Touches** body is **snake_case** (`kind`, `portal_key`, `idempotency_id`, …).
- **Fill-events** body is **camelCase** (`caseId`, `portalKey`, …).
- Profile locked snake_case: `selected_facility_id`, `meta.needs_facility`.
- Token keys are bare (`provider.firstName`), never `{{braced}}`.
- Field-map POST is propose-only — server forces `proposed` / `manual` / `token: null`.
- Only `approved` maps fill.

Source of truth: `src/server/api.ts`. Extension mirror types: `minted-extension` → `src/shared/apiTypes.ts`.
