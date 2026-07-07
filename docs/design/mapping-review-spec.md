# Mapping review — component spec (PR B)

Surface 2 of the cleanup package: the card-by-card training flow for a new
payer form. Mockups: `mockups/cleanup-surfaces.html`, tab "2 · Mapping
review", plates 2.1–2.4. Requires PR A (schema + portals service).

**Scope of this PR:** route `/portals/$portalKey/train`, the training state
machine + components, token-picker, dictionary learning, done state, and the
service/hook mutations they need.

## Inputs and writes

Trains the portal's **org-scoped `proposed`** rows in `portal_field_maps`
(global rows are read-only in the app; captured rows land org-scoped).
Each row carries `field_label`, `form_section`, `field_type`, optional
suggested `token`, optional `confidence` (0–100).

Decisions write immediately (resumable by construction):

| Action                | Row update                                                            | Extra                                                                 |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Approve (A)           | `status='approved'`, `source='token'`, token = suggestion             | dictionary upsert (below)                                             |
| Edit (E) → pick token | `status='approved'`, `source='token'`, token = picked                 | dictionary upsert; +1 good catch (overrode a suggestion)              |
| Manual (M)            | `status='approved'`, `source='manual'`, `token=null`                  | counted out of auto-fill coverage                                     |
| Confirm all N         | one `update … in (ids)` to approved                                   | one audit row (`description: "Batch-approved N field maps (portal)"`) |
| Undo (U)              | previous row back to `status='proposed'` (restore prior token/source) | decrements session tallies; single-level undo is enough for v1        |

Token normalization: always store the **bare catalog form** via
`normalizeTokenKey` (`src/lib/tokenFormat.ts`) — same contract the server
enforces at its read boundary.

**Dictionary upsert** (on every token approval, `field_dictionary`):

- No row for `(org, normalizeFieldLabel(label))` → insert `suggested`,
  `seen_count=1`, token = approved token.
- Row exists, same token → `seen_count + 1`.
- Row exists, different token → reset token to the new one, `seen_count=1`,
  back to `suggested` (a changed mind restarts the evidence count) — unless
  the row is `rejected`, which is never modified here.
- Never auto-confirm; confirmation is the human's "Yes, always" (Fix-it card).

**On finishing all fields**: set the portal `is_verified=true`,
`last_verified_at=now()` (training is a verification pass), audit UPDATE.

## Confidence resolution (client, pure — `src/lib/mappingConfidence.ts`, tested)

```ts
export type Confidence = "high" | "medium" | "low";
export function resolveConfidence(row, dictionary): Confidence;
// confirmed dictionary rule matches normalizeFieldLabel(row.fieldLabel) → "high"
// row.confidence >= 80 → "high";  >= 40 or any token suggestion → "medium"
// else → "low"
export function splitBatch(rows, dictionary): { batch: Row[]; cards: Row[] };
// batch = high-confidence rows WITH a token; everything else → cards,
// ordered: form_section capture order, then medium before low.
```

## Route + guard

`src/routes/portals.$portalKey.train.tsx` (dotted file route; no parent
`portals.tsx` needed — same pattern as `tasks.$id.tsx`). Writers only:
`beforeLoad` role check + render-time `useCanWrite()` backstop (the
known hard-load gotcha — same as `providers.new.tsx`). Billing gets the
standard redirect Home.

Data: `usePortalFieldMaps(portalKey)` (PR A), `useFieldDictionary()` (new,
key `fieldDictionary(orgId)`), token catalog via
`get_sop_field_tokens` RPC — **call bound**
(`supabase.rpc.bind(supabase)`), service `src/services/lookups.ts` or a new
`tokenCatalog.ts`, query key `["token-catalog", orgId]`, staleTime
`FIVE_MINUTES` (the catalog is near-static). Append the `user.name` /
`user.email` family client-side (mirrors `src/server/userTokens.ts`).

## Screen flow (state machine in the route: `phase: "batch" | "cards" | "done"`)

Work surface — `var(--mp-*)` tokens, content column `max-w-[720px] mx-auto`.

### Header (all phases, mockup 2.1)

Back link "← Portals" (`/admin/portals`), title
"Train: {portal.name} — {form label if known else 'Form'}", right action
ghost "Save & exit" (navigates back; decisions already persisted).
Under it: 4px progress bar (`--mp-primary` fill on `--mp-muted` track) +
meta row "`{decided} of {total} decided`" / "`captured {fmtDate} ·
{hostname(formUrl)}`". **Never a timer.**

### Phase 1 — batch confirm (only when `batch.length > 0`)

Card: heading "**{N} fields matched with high confidence**", sub "Exact
label matches and your confirmed dictionary rules. Confirm them together —
every row stays editable later in Portals." Rows grouped by `form_section`
(uppercase 11px group headers): `field_label` (+ muted "dictionary rule"
provenance when that's the source) · token chip · `High` badge. Footer:
primary "Confirm all {N}" · outline "Review one by one" (demotes the whole
batch into the card flow) · muted right note "Then {cards.length} fields,
one card at a time."

### Phase 2 — card review (mockups 2.2, 2.3)

One card per field:

- Eyebrow: "Section {n} · {form_section}" — muted uppercase.
- Field label **quoted**, 21px semibold: `"County of Primary Practice
Location"`. Under it muted: "`{field_type}` · required on the form" (when
  captured as required).
- Suggestion row (`bg-[#FAFAF9]` bordered): "SUGGESTED" cap label · token
  chip · confidence badge · right muted provenance ("dictionary rule" /
  "label similarity · no dictionary rule yet"). Low-confidence cards render
  the picker open instead of a suggestion row.
- Actions: primary **Approve** (keycap A) · outline **Edit** (E) · outline
  **Manual** (M). Below: link "↩ Undo last decision (U)".
- Manual affordance fine print (once, under the buttons):
  "Manual = you'll fill this one by hand each time — right for e-signatures
  and uploads."

**Token picker (Edit, mockup 2.3):** bordered panel replacing the suggestion
row — search input autofocused; results grouped by family (Facility,
Provider, Group, …): token chip · human column label · mono source column
(`facilities.county`). Footer hints "↑↓ navigate · Enter select · Esc
cancel · 132 tokens · closed catalog". No free-text tokens — unmappable is
what Manual is for.

**Keyboard:** global `keydown` on the route — `A`/`E`/`M`/`U` per above;
ignored while the picker's input has focus (there: ↑↓/Enter/Esc). Buttons
show `<kbd>`-style keycaps (11px mono bordered).

### Phase 3 — done (mockup 2.4)

Centered card, green check ring (2px border circle, no fill, no shadow):

> **This form is ready.**
> {portal.name} — Provider Enrollment is now trained and marked **Verified**.

Stat row (bordered, three cells): "**46** of 52 auto-fills" · "**10** your
decisions" · "**6** labels learned". Fine print: "{manualCount} fields stay
manual: {first three labels}." Buttons: outline "Back to Portals" · primary
"Fix next card in queue" (→ `/fix-it`, only when the Fix-it PR is live;
until then "Done" → `/admin/portals`).

- _auto-fills_ = approved rows with `source token|hardcoded` (denominator =
  all approved rows).
- _your decisions_ = per-card decisions this session (batch counts as one
  decision per… no: batch = N approved but "decisions" counts **card-flow
  decisions + 1 for the batch**? No — mockup says decisions: 10 with 34
  batched: it's the count of individual calls the human made = card decisions
  - (batch confirmed ? 1 : 0) … Lock: **"Your decisions" = number of cards
    decided one-at-a-time + 1 if the batch was confirmed as a whole.** The
    point of the number is "the machine did the rest."
- _labels learned_ = dictionary upserts this session (created or bumped).

### Edge states

- **Nothing to train** (`proposed == 0`): `EmptyState` "This form is fully
  trained" + description "New fields appear when the extension captures a
  changed form." + Back to Portals.
- **Load error**: red error box + Retry (refetch).
- **Mutation error**: sonner toast "Couldn't save that decision — retry", card
  stays; no optimistic advance (advance on mutation success only; disable
  the three buttons while in flight).
- **Unknown `portalKey`**: EmptyState "Portal not found" + Back to Portals.

## Hooks/mutations (`src/hooks/useMappingReview.ts`, new)

- `useTrainingRows(portalKey)` — select over `usePortalFieldMaps`, split via
  `splitBatch`.
- `useDecideField()` — mutation(rowId, decision) doing the row update +
  dictionary upsert + audit (service fns
  `approveFieldMap`, `markFieldMapManual`, `batchApproveFieldMaps`,
  `upsertDictionaryEntry` in `portalFieldMaps.ts` / new
  `fieldDictionary.ts`). Invalidate `portalFieldMaps(orgId, portalKey)`,
  `fieldDictionary(orgId)`, `portals(orgId)`.
- `useFinishTraining()` — portal verify stamp.
- Session tallies (`decisions`, `goodCatches`, `labelsLearned`) live in
  route-local `useReducer`, not the cache.

## Acceptance criteria

1. A portal with 5 proposed rows (2 high via dictionary, 2 medium, 1 no
   suggestion) walks: batch of 2 → confirm-all → 3 cards → done; every
   decision visible in `portal_field_maps` with bare-form tokens; portal
   flips Verified.
2. A/E/M/U keys work; keys dead while the picker input is focused; picker is
   keyboard-completable end to end.
3. "Review one by one" demotes batch rows into cards; Undo restores the last
   row to proposed and rewinds tallies.
4. Dictionary rows created/bumped per the upsert table; a `rejected` label is
   never modified and never re-suggested (its suggestion renders as Low with
   no token).
5. Refresh mid-flow resumes at the next undecided field with correct
   progress; done state matches the locked copy
   ("This form is ready. Auto-fills X of Y…").
6. No timers or speed affordances anywhere; `tsc`, lint, vitest green
   (confidence lib + splitBatch + dictionary upsert covered by unit tests;
   hooks by a query-shape fake like `*.di.test.ts`).
