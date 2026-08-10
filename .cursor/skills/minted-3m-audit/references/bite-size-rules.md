# Bite-size rules

## Definition of a bite

A bite is mergeable by one reviewer in one sitting:

- **≤ ~400 lines** net product diff preferred (docs-only can be larger).
- **One primary user-visible behavior** or **one ops/doc truth** or **one migration theme**.
- **One repo** unless a thin sync PR is required (call the sync out as Bite N+1, not a drive-by).
- **Testable AC** in the issue/PR (Given/When/Then or checkbox list).
- **Rollback story:** revert PR, or feature-flag, or additive migration left in place.

## Untangle patterns (use these templates)

### Godfile / god component

- Bite A: extract pure helpers + unit tests (no UI change).
- Bite B: extract one presentational chunk.
- Bite C: extract data hook.
- Bite D: behavior change.
  Never combine A–D.

### Dual source of truth

- Bite A: document the two paths + which is canonical (spike doc).
- Bite B: make secondary read-only or warn.
- Bite C: write only to canonical.
- Bite D: delete secondary.

### API vs RLS drift

- Bite A: add regression test or shared helper on one door.
- Bite B: align the other door.
- Bite C: remove dead endpoint/client.

### Large cleanup (e.g. delete N rows)

- Bite 0: inventory SQL + keep rules + fan-out map (no DELETE).
- Bite 1: candidate list artifact + PM sign-off.
- Bite 2: backup + DELETE in batches behind maintenance window.
- Bite 3: UI/empty-state verification.

### “Platform overhaul”

Never one PR. Require a spike doc with D-decisions first (see Slice 6), then:

1. Schema/RPC
2. Service/helper
3. UI wiring
4. Extension alignment (if needed)
5. Docs/TECH-DEBT close-out

## Recommendation shape (copy this)

```markdown
### BITE-<area>-<nn>: <title>

- **3M:** Muri | Mura | Muda
- **Repos:** panel | extension | both | ops
- **Depends on:** none | BITE-…
- **Problem:** ≤2 sentences
- **Change:** bullets, files if known
- **AC:** 2–5 checks
- **Out of scope:** explicit
- **PM decision needed:** none | question
```

## Anti-patterns

- “Refactor Train + fix listPortals + delete payers” as one item.
- Recommendations that are only “investigate” with no exit criteria.
- Re-opening signed D-decisions as soft suggestions.
- Hosted ops buried inside a code bite — split **ops** bites.
