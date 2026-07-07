# Portals admin — component spec (PR A)

Surface 3 of the cleanup package. Mockups: `mockups/cleanup-surfaces.html`,
tab "3 · Portals admin", plates 3.1–3.4. Read
`cleanup-surfaces-overview.md` first (shared concepts + data model).

**Scope of this PR:** the cleanup-package migration (all of it — portals,
field_dictionary, additive columns, RLS), the `/admin/portals` screen, its
services/hooks/types, and the Admin nav entry. One PR.

## Migration

New file `supabase/migrations/<ts>_cleanup_surfaces_schema.sql`, applied
identically to hosted via MCP `apply_migration`. Guard everything so a
repo-only rebuild passes (`IF NOT EXISTS`, `DROP POLICY IF EXISTS` before
`CREATE POLICY`). Verify live state first (MCP `list_tables` /
`information_schema`) — especially whether `portal_field_maps` and
`fill_sessions` already have RLS enabled/policies.

```sql
-- 1. portals registry (org-scoped)
CREATE TABLE IF NOT EXISTS public.portals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  portal_key text NOT NULL,
  name text NOT NULL,
  payer_id uuid REFERENCES public.payers(id),
  form_url text,
  is_verified boolean NOT NULL DEFAULT false,
  last_verified_at timestamptz,
  url_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, portal_key)
);
ALTER TABLE public.portals ENABLE ROW LEVEL SECURITY;
CREATE POLICY portals_select ON public.portals FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()));
CREATE POLICY portals_write_ins ON public.portals FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT user_org_ids())
              AND user_role(org_id) IN ('admin','specialist'));
CREATE POLICY portals_write_upd ON public.portals FOR UPDATE TO authenticated
  USING (org_id IN (SELECT user_org_ids())
         AND user_role(org_id) IN ('admin','specialist'))
  WITH CHECK (org_id IN (SELECT user_org_ids())
              AND user_role(org_id) IN ('admin','specialist'));
GRANT SELECT, INSERT, UPDATE ON public.portals TO authenticated;

-- 2. field_dictionary (used by PRs B and C; created here with the rest)
CREATE TABLE IF NOT EXISTS public.field_dictionary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  label_normalized text NOT NULL,
  token text NOT NULL,
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested','confirmed','rejected')),
  seen_count integer NOT NULL DEFAULT 1,
  decided_at timestamptz,
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, label_normalized)
);
-- RLS: same three policies + grants as portals.

-- 3. additive columns for training (PR B reads/writes them)
ALTER TABLE public.portal_field_maps ADD COLUMN IF NOT EXISTS field_label text;
ALTER TABLE public.portal_field_maps ADD COLUMN IF NOT EXISTS form_section text;
ALTER TABLE public.portal_field_maps ADD COLUMN IF NOT EXISTS confidence smallint;

-- 4. browser access under RLS (service-role API path is unaffected)
-- portal_field_maps: member read of global + own-org rows; writer writes on
-- own-org rows ONLY (global rows stay read-only in the app).
ALTER TABLE public.portal_field_maps ENABLE ROW LEVEL SECURITY;
CREATE POLICY pfm_select_app ON public.portal_field_maps FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id IN (SELECT user_org_ids()));
CREATE POLICY pfm_insert_app ON public.portal_field_maps FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT user_org_ids())
              AND user_role(org_id) IN ('admin','specialist'));
CREATE POLICY pfm_update_app ON public.portal_field_maps FOR UPDATE TO authenticated
  USING (org_id IN (SELECT user_org_ids())
         AND user_role(org_id) IN ('admin','specialist'))
  WITH CHECK (org_id IN (SELECT user_org_ids())
              AND user_role(org_id) IN ('admin','specialist'));
GRANT SELECT, INSERT, UPDATE ON public.portal_field_maps TO authenticated;

-- fill_sessions: member read (for last-fill column) — add only if absent live.
CREATE POLICY fs_select_app ON public.fill_sessions FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()));
GRANT SELECT ON public.fill_sessions TO authenticated;
```

After applying: regenerate `src/integrations/supabase/types.ts` via MCP
`generate_typescript_types` + prettier; update `SCHEMA.md`.

## Types (`src/types/index.ts`, append)

```ts
export type FieldDictionaryStatus = "suggested" | "confirmed" | "rejected";

export interface Portal {
  id: string;
  orgId: string;
  portalKey: string;
  name: string;
  payerId: string | null;
  formUrl: string | null;
  isVerified: boolean;
  lastVerifiedAt: string | null;
  urlChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface FieldDictionaryEntry {
  id: string;
  orgId: string;
  labelNormalized: string;
  token: string;
  status: FieldDictionaryStatus;
  seenCount: number;
  decidedAt: string | null;
  decidedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Also extend `PortalFieldMap` (additive): `fieldLabel: string | null;
formSection: string | null; confidence: number | null;`.

## Service (`src/services/portals.ts`, new)

Browser pattern (mirror `payers.ts`): `externalClient` import,
`requireActiveOrg()`, `writeAudit` on mutations, `camelizeRow`.

```ts
export async function listPortals(): Promise<Portal[]>; // org rows, order name asc
export async function createPortal(input: PortalInput): Promise<Portal>;
// PortalInput = { name, portalKey, payerId?, formUrl? } — portalKey slugified
// from name in the modal, editable; org_id from requireActiveOrg().
export async function updatePortalUrl(id: string, formUrl: string): Promise<Portal>;
// Sets form_url, is_verified = false, url_changed_at = now(), updated_at.
// Audit: UPDATE portal, before/after { formUrl, isVerified }.
```

`src/services/portalFieldMaps.ts` (existing, ctx-injected — keep the server
path untouched): add a browser-side reader + count helpers at the bottom:

```ts
export async function listPortalFieldMapsFromApp(portalKey?: string): Promise<PortalFieldMap[]>;
// externalClient + requireActiveOrg(); same .or(`org_id.is.null,org_id.eq.${orgId}`)
// filter and normalizeTokenKey mapping as listPortalFieldMaps.
```

`src/services/fillSessions.ts`: add
`export async function listLastFillsFromApp(): Promise<FillSession[]>` —
org rows, `order started_at desc, limit 200`; the hook reduces to latest per
`portal_key`.

## Hooks (`src/hooks/usePortals.ts`, new) + query keys

Add to `queryKeys`: `portals(orgId)`, `portalFieldMaps(orgId, portalKey ?? "all")`,
`lastFills(orgId)`, `fieldDictionary(orgId)`.

- `usePortals()` — list query.
- `usePortalFieldMaps(portalKey?)`, `useLastFills()` (returns
  `Map<portalKey, FillSession>` via select).
- `useCreatePortal()`, `useUpdatePortalUrl()` — invalidate `["portals", orgId]`.
- Derived in the route via `useMemo`: per portal —
  `mapped` (= approved rows count), `proposed` (= proposed rows count),
  `lastFill` (from the map).

## Route `src/routes/admin.portals.tsx` (new) + nav

- Sidebar: add `{ to: "/admin/portals", label: "Portals", icon: Globe }` to
  `adminNav` (between Payers and Audit Log). Protected-file touch sanctioned
  by this package; one line.
- Page is admin-gated the way other `/admin/*` pages are (`useIsAdmin()` for
  write affordances; the nav group already hides for non-admins).

Layout per mockup 3.1 (admin conventions: `PageHeader`, info band, hand-rolled
table in a `border-[#E8E5E0] rounded-md bg-white` card):

- `PageHeader` title "Portals", description "Payer portals the extension can
  fill — URLs, field maps, and verification." Action: `+ Add portal`
  (primary, admin only).
- Info band (`bg-[#FAFAF9]`): "Field selectors are captured by the extension
  and approved in training. This screen manages where they point and whether
  they're trusted."
- Columns: **Portal** (name + `portal_key` in 11px mono muted under it) ·
  **Payer** (payer name via `usePayers`, else "Multi-payer" when `payerId`
  null) · **Form URL** (mono, truncated, title attr full) · **Fields**
  ("52 mapped" + amber `StatusPill` "N proposed" when N > 0) · **Status** ·
  **Verified on** (`fmtDate(lastVerifiedAt)` else "—") · **Last fill** ·
  kebab (`DropdownMenu`).
- **Status pill logic** (legacy `StatusPill`):
  `isVerified` → green "Verified"; `!isVerified && urlChangedAt &&
lastVerifiedAt` → amber "Needs re-verify"; else neutral "Unverified".
- **Last fill cell**: latest fill session for the key —
  `fieldsFilled > 0` → green "`{fieldsFilled} of {mapped}`" + muted "· MMM d";
  `fieldsFilled === 0` → red "Failed · MMM d"; none → muted "No fills yet".
  (Denominator is the _current_ mapped count — an approximation; fine for v1.)
- Rows with `proposed > 0` show a visible `Train` row-button instead of
  relying on the kebab.
- Row kebab: **Edit URL** (inline editor), **View fields** (dialog),
  **Train this form** → navigate `/portals/$portalKey/train` (route ships in
  PR B; until then hide the item behind the same flag the Fields dialog CTA
  uses — simplest: land PR A with the kebab item pointing at the route and
  merge B before release, or gate on `import.meta.env` — pick the former).

### Inline URL edit (mockup 3.2)

Expanding editor row directly under the row (not a modal): mono input
pre-filled with current URL, `Save URL` primary (h-30) + `Cancel` outline,
and the amber note box:

> ⚠ {mapped} field selectors were captured on the current page. If the payer
> moved the form, they may not match the new URL — saving marks this portal
> **Unverified** until the next successful fill or training pass.

Save → `useUpdatePortalUrl` → toast "Portal URL updated". Escape/Cancel
collapses without saving.

### View fields (mockup 3.3)

Right-docked `Dialog` (no Sheet primitive in `ui/`; use `DialogContent` with
`className="fixed right-0 top-0 h-full max-w-[400px] rounded-none …"`).
Read-only list of the portal's field maps grouped by `form_section` (fall
back to `page_step`, then "Fields"): row = `field_label` (fall back to
`selector` mono) · token chip (brand-tinted mono; `source==='manual'` renders
a ghosted "manual" chip) · `field_type` muted. Footer: "{globalCount} global
rows · {orgCount} org overrides" + `Train this form` button. Copy under the
title: "Read-only. Fields are decided in training, not here."

### Add portal modal

Mount-when-editing `Dialog` (create-only, no edit mode): Name (required),
Portal key (auto-slug from name, editable, mono), Payer (`Select`, options
from `usePayers` + "Multi-payer" → null, `"__none__"` sentinel), Form URL.
Footer: outline Cancel + primary `bg-[#1B4D3E]` Create. Duplicate
`(org, portal_key)` unique violation → inline red error box "A portal with
this key already exists."

### States

- **Loading**: `TableSkeletonRows rows={6} cols={8}`.
- **Empty** (mockup 3.4): `EmptyState` message "No portals yet", description
  "Portals appear here automatically the first time the extension captures a
  payer form. You can also add one by hand to stage a URL before capture.",
  action `+ Add portal` (outline sm).
- **Error**: red error box "Couldn't load portals. Your connection may have
  dropped — retry, or refresh the page." + Retry (refetch), inside the table
  card like `admin.payers.tsx`.

## Acceptance criteria

1. Migration applies to hosted via MCP and to a bare rebuild; types
   regenerated; `SCHEMA.md` updated.
2. `/admin/portals` renders registry rows with derived mapped/proposed
   counts and last-fill results; billing/specialist see the page read-only
   via nav? No — page is admin-only (nav group hidden otherwise).
3. URL edit stamps `is_verified=false` + `url_changed_at`, writes one audit
   row, and the status pill flips to Needs re-verify when previously verified.
4. Add portal enforces unique key per org with a friendly error.
5. All four states (loading/rows/empty/error) reachable; no `select('*')`
   in list payloads; no console.log/TODO; `npx tsc --noEmit` and `npm run
lint`/`test` green.
6. Browser can read `portal_field_maps` under RLS; cross-org rows are
   invisible (verify with the second demo org); `/api` responses unchanged
   (spot-check `scripts/verify-isolation-local.mjs` still green).
