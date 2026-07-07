# Fix-it queue — component spec (PR C)

Surface 1 of the cleanup package: a deck of 30-second decisions that improve
fill coverage. Mockups: `mockups/cleanup-surfaces.html`, tab "1 · Fix-it
queue", plates 1.1–1.4. Requires PRs A + B (portals, dictionary, training
route).

**Scope of this PR:** the queue-derivation lib (pure + tested), `/fix-it`
route, the Home/Today section, the sidebar entry with live count, the three
card types, session summary, and the small services/mutations they need.

## Card types and their writes

| Type                 | Trigger                                                                           | Actions                                    | Writes                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provider_gap`       | An approved field map's token resolves empty for a provider with an upcoming fill | inline input → **Save** / **Skip for now** | Save: `updateProvider` (existing service, audited). Skip: `createTasksForCase` one task on the blocking case — title "Collect {field label} for {provider first name}", `due_date` = blocked fill date |
| `dictionary_confirm` | `field_dictionary` row `status='suggested'` and `seen_count >= 2`                 | **Yes, always** / **No, keep asking**      | Yes → `status='confirmed'`; No → `status='rejected'` (+1 good catch). Both stamp `decided_at/by`, audit UPDATE                                                                                         |
| `train_form`         | A portal with `proposed > 0` field maps                                           | **Train this form** / **Later**            | Train → navigate `/portals/$portalKey/train`. Later → card drops to queue tail for this session (no write)                                                                                             |

No other card types in v1. Cards never expire silently — they leave the
queue only via an action or because the underlying gap closed.

## Queue derivation — `src/lib/fixitQueue.ts` (pure, unit-tested)

```ts
export interface FixitCard { kind; sortDate: string | null; impact: {...}; ... }
export function buildFixitQueue(input: {
  providers: Provider[];
  openCases: CaseWithNextDue[];      // open = actionState !== complete; nextDue = earliest open task due_date
  portals: Portal[];                  // payer_id → portal
  approvedMaps: PortalFieldMap[];     // status approved, source token
  dictionary: FieldDictionaryEntry[];
  proposedCounts: Map<portalKey, number>;
  groups: ProviderGroup[];
}): FixitCard[]
```

- **Gap detection, v1 scope:** only tokens in the `provider.*` family that
  map to inline-editable columns — the whitelist in
  `src/lib/fixitFields.ts` (below). Other families (license._, facility._,
  group.*) are out of scope for v1 cards; the coverage _meter_ still counts
  them via general resolution where the data is already in the client cache,
  else treats them as resolved (documented approximation).
- **One card per (provider, field)** even when several cases are blocked;
  the impact line names the soonest one, and `+N more fills` when more.
- **Ordering — impact, never ease (locked):** `sortDate` asc (nulls last) =
  the blocking case's next open task `due_date`, else the case
  `expected_effective_date`, else null. Dictionary/train cards get
  `sortDate` = the earliest open case date for a payer their portal serves,
  else null. Tie-break: fields unlocked desc, then provider name. **No
  weighting by effort anywhere.**
- **Coverage meter numbers:** `coverageFor(provider, portal)` → `{filled,
total, gain}` where `gain` = fields this card's token unlocks (a token can
  back several fields).

`src/lib/fixitFields.ts` — the editable-field registry:

```ts
export const FIXIT_FIELDS: Record<string /* bare token */, {
  column: keyof Provider; label: string; placeholder: string;
  hint: string; validate?: (v: string) => string | null;
}> = {
  "provider.caqhId": { column: "caqhId", label: "CAQH ID",
    placeholder: "8-digit ID, e.g. 14382950",
    hint: "From CAQH ProView → provider record.",
    validate: v => /^\d{8}$/.test(v) ? null : "CAQH IDs are 8 digits." },
  "provider.npi": { …, validate: 10-digit + Luhn-ish check as in providers form },
  "provider.deaNumber", "provider.taxonomyCode", "provider.email",
  "provider.phone", "provider.caqhLastAttestedDate" (date input) …
};
```

(Never `provider.ssnLast4` — PHI entry stays on the provider form.)

## Routes, nav, gating

- `src/routes/fix-it.tsx` — the queue page. Writers only (billing is
  read-only; the surface is all mutations): `beforeLoad` + render-time
  `useCanWrite()` backstop; billing redirects Home.
- Sidebar `mainNav`: `{ to: "/fix-it", label: "Fix-it", icon: Zap }` directly
  under Home, rendered only for writers (same conditional pattern as
  `clientProgressNav`), with a live count chip (white/15 pill, tabular-nums)
  when count > 0 — **no badge at zero, never "0"**. Count from
  `useFixitQueue()` (shared cache; the hook is cheap once Home has warmed
  the underlying queries).
- Home (`src/routes/home.tsx`): new section ABOVE "Needs action" using the
  existing `HomeSection` shell — title "Fix-it queue", count, `HomeViewAllLink
to="/fix-it"`, top **3** cards as rows (mockup 1.1): left = bold
  subject + muted detail ("Brian Nguyen · missing CAQH ID"), middle = impact
  meta (amber `text-[color:var(--mp-warn)]` when dated: "blocks BCBS KS ·
  fill due Jul 9"), right `RowCta` ("Fix" / "Review" / "Train") linking to
  `/fix-it` (optionally `?card=<id>` to front that card). Zero cards →
  the shell's built-in "Fix-it queue — clear" line.

## Queue page (`/fix-it`, work surface, `var(--mp-*)` tokens)

`PageHeader` title "Fix-it queue", description "Each card is one decision.
Clearing it improves tomorrow's fills." Right slot: the **good-catch chip**
(brand-tinted pill): "✓ {n} good catches this week".

Deck (`max-w-[600px] mx-auto`, mockup 1.2):

- Deck header: "**Card {i} of {n}** · ordered by soonest blocked fill" ·
  right muted "Skip never loses work".
- One active card + two stacked border "stubs" under it (pure CSS, no
  shadows). Advance = next card mounts; **no timed transitions, no timers.**

### Card anatomy

Shared: type chip (uppercase 10.5px — "Provider data" blue-tinted,
"Dictionary" brand-tinted, "New form" amber-tinted), right-aligned impact
line ("Blocks BCBS KS · fill due Wed, Jul 9" in `--mp-warn`; undated cards
use muted copy), 18px semibold title, 13px muted body.

**provider_gap** adds: coverage meter (6px track `--mp-muted`; solid
`--mp-primary` = fills today; lighter `#7fc79f` segment = the gain;
caption "Green fills today · light green unlocks when this card is saved
(+{gain} fields)"), labeled input from `FIXIT_FIELDS` (with hint +
validation error in standard red text), footer: primary **Save** · outline
**Skip for now** · right fine print "Skip creates a follow-up task on the
{payer} case, due {date}".

- Save: validate → `updateProvider` → toast "Saved — {provider} is now
  {filled}/{total} for {payer}" → advance. Failure: toast error, stay.
- Skip: `createTasksForCase` → toast "Follow-up task created" → advance.

**dictionary_confirm**: mapping row (`bg-[--mp-muted]` bordered): quoted
label → token chip + right muted "{seenCount} of {seenCount} mappings
agree"; footer: primary **Yes, always** · outline **No, keep asking** ·
fine print "'No' is a good catch — it keeps a wrong guess out of every
future form."

**train_form**: pre-matched meter ({matched} / {total}), footer: primary
**Train this form** · outline **Later** · fine print "~3 minutes · opens
mapping review". (The estimate is static copy — sized by field count
buckets, never measured against the user.)

### Session summary (finish state, mockup 1.4)

When the last card clears (session tallies in route-local `useReducer`):
centered card, green check ring, "**{n} cards cleared.**" then up to three
outcome lines (green dot bullets):

- "**{provider} is now 100% for {payer}** — {total} of {total} fields
  auto-fill on {portal}." (only when a meter crossed to full)
- "**{k} follow-up task(s) created** — '{title}', on the {payer} case, due
  {date}."
- "**{k} good catch(es)** — '{label}' won't be guessed on future forms."

Buttons: outline "Back to Home" · primary "Done" (also Home). **Deliberately
absent: elapsed time, cards/minute, streaks.**

### Empty state

`EmptyState` in a card: "Queue is clear" / "Nothing blocks the next fills.
New cards appear when the extension meets a field it can't fill or a form it
doesn't know." + the good-catch chip.

### Loading / error

Skeleton: one card-shaped `Skeleton` block in the deck. Error: red error box

- Retry.

## Good-catch counter

Session count lives in the route reducer. The persistent weekly figure is
client-local v1: `localStorage["mp-good-catches:<orgId>:<userId>"]` =
`{ weekStartISO, count }`, incremented on dictionary "No" and training Edit
overrides, reset when the ISO week rolls. (Server persistence can follow;
not worth a table for v1.) Never displayed as a comparison or target —
always "✓ N good catches this week", brand tint, celebratory copy only.

## Hooks (`src/hooks/useFixit.ts`) + query keys

- `useFixitQueue()` — composes existing caches (`useProviders`, `useCases`,
  `useTasks`, `usePayers`, `usePortals`, `usePortalFieldMaps`,
  `useFieldDictionary`) through `buildFixitQueue` in a `select`/`useMemo`;
  no new server round-trips beyond PR A's hooks. Query key for the derived
  count where needed: `fixit(orgId)`.
- `useDecideDictionary()` — confirm/reject mutation (service
  `fieldDictionary.ts` from PR B), invalidates `fieldDictionary(orgId)`.
- Provider save + task creation reuse existing services/hooks untouched.

## Acceptance criteria

1. `buildFixitQueue` unit tests pin: impact ordering (dated before undated,
   soonest first, fields-unlocked tie-break), one card per (provider,field),
   dictionary threshold (`seen_count >= 2`, suggested only), train cards for
   proposed > 0, and that NOTHING in the sort consults effort/ease.
2. Deck walk: gap Save writes the provider column + audit and advances; Skip
   creates the task with the right title/due date; dictionary Yes/No writes
   status + good catch on No; Later re-queues to tail without a write.
3. Home section shows top 3 by the same order, collapses to "— clear" at
   zero; sidebar badge = queue length, absent at zero, never rendered for
   billing.
4. Session summary shows only outcome lines that actually happened; no time
   figures exist in the DOM.
5. Coverage meter numbers agree with the Portals "Last fill" denominator for
   the same portal (one `coverageFor` implementation, not two).
6. `tsc`, lint, vitest green; queue lib fully covered; no console.log/TODO;
   no new dependencies.
