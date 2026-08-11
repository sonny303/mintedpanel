# SOP setup validation checklist

Use after drafting an action list. Fail closed — do not invent missing pieces.

## Mode rules

| Mode | Must have | Must not |
| ---- | --------- | -------- |
| **Portal form** (`online_form`) | Non-empty `portalKey` (existing registry key); Auto-fill / `extension_fill` when the intent is extension fill | Invented selectors, fake mapping %, guessed portal keys |
| **Draft email** (`draft_email`) | ≥1 **To** (literal valid email and/or email-valued token, e.g. `provider.email`); subject/body as needed | Empty To; BCC; auto-send; non-email tokens as recipients |
| **Phone / Fax / Mail** | Clear label; optional turnaround / follow-up cadence days | Portal keys or autofill |
| **PDF** | Packet intent; send channel (mail/fax) when applicable | Treating PDF as live if product still marks it coming-soon |

## Coupling (portal ↔ autofill)

- Portal / autofill intent ⇒ `online_form` **and** `portalKey` **and** `extension_fill`.
- `online_form` without portal key ⇒ **fail** (unlinked form).
- `extension_fill` without `online_form`+portal ⇒ **fail** (Workbench never tees up).
- Do not teach dual mandatory enums as the happy path; Mode implies the stored pair.

## Tokens & fields

- Data fields = closed catalog tokens only (`get_sop_field_tokens` / authoring picker).
- Missing token ⇒ flag for human; never free-text a pseudo-token.
- Contact-role tokens (`billingContact.*`, etc.) are form values — not
  `draft_email` recipients unless product explicitly allows them (today: no).

## Field maps

- **Never invent** `portal_field_maps` rows, selectors, approve/token bindings, or
  coverage percentages.
- Capture → train → dry-run → prove is runbook §6 (human + extension).
- Coach may say "register portal X, then capture" — never emit a map table as truth.

## Publish & Ready

- **Never** call publish RPCs or write version bumps.
- Label optional JSON/YAML as `DRAFT — not published`.
- **Ready** (#277) = checklist SOP presence (≥1 active global SOP with ≥1 task).
- Refuse changing Ready to mean published + proven (or any train/prove/drift gate).
- Prove / mapping coverage / dry-run = soft badges / go-live §6–7 — not Ready.

## Git / source of truth

- Refuse committing payer-specific SOPs into the repo as the canonical source.
- DB versioned templates (+ human publish) are canonical; seeds/fixtures are not
  the operator workbook.
- Docs/skill updates that describe the coach are fine; payer SOP content is not.

## Pass / fail summary line

`PASS` only if every drafted action meets its mode rule, portal↔autofill
coupling holds, no invented maps, and no publish/Ready-gate change was proposed.
Otherwise `FAIL` with the failing row ids.
