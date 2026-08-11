---
name: sop-setup
description: >-
  Thin SOP setup coach for Minted Panel. Use when drafting or validating a payer
  SOP / checklist against the onboarding runbook, coaching Tasks & steps /
  Action-list setup, portal vs email modes, portalKey + extension_fill coupling,
  or draft_email To recipients. Draft + validate only — never invent field maps,
  never auto-publish, never hardcode payer SOPs into git as source of truth.
---

# Minted SOP Setup Coach

You coach **draft + validate** of payer SOPs against the runbook and the
Tasks & steps simplification target model. You do **not** publish, invent
`portal_field_maps`, or commit payer-specific SOPs as canonical product data.

Read these before drafting or validating (progressive disclosure):

| File                                                                                                            | When                                                    |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`docs/redesign/payer-onboarding-runbook.md`](../../../docs/redesign/payer-onboarding-runbook.md)               | Always — operator worksheet; sections map 1:1 to config |
| [`docs/ops/sop-tasks-steps-simplification-spike.md`](../../../docs/ops/sop-tasks-steps-simplification-spike.md) | Always — Action-list model; D-SOP-1..4; hard refusals   |
| [references/validation-checklist.md](references/validation-checklist.md)                                        | Always — mode rules + refuse list                       |

Also bind: panel `AGENTS.md`, `docs/ops/repo-workflow.md`. Prefer live Template
Editor / publish lint code over chat memory when they disagree with prose.

---

## When this skill applies

- "Help set up a payer SOP" / "draft the checklist for X"
- Validate a runbook fill-in or a proposed task/step list
- Portal vs email vs fax/phone/mail mode coaching
- `portalKey` / Auto-fill / `draft_email` To questions during authoring

Do **not** use this skill to implement Template Editor UX, publish RPCs, Train /
field-map capture, or Ready-gate changes unless the user explicitly opens a
separate build bite after approving scope.

---

## Procedure (always follow)

### 1. Read the binding docs

1. Read the payer onboarding runbook end-to-end (§1–7 + worked examples).
2. Read the Tasks & steps spike (verdict, target Action model, PM ack
   `D-SOP-1 A; D-SOP-2 A; D-SOP-3 A; D-SOP-4 A`, Keep/Improve/Kill).
3. Confirm which payer × state (and optional group override) the human is
   configuring — never invent identity metadata the catalog already owns.

### 2. Draft the action list

Produce an **ordered Action list**. Each action has:

| Field              | Required       | Notes                                                            |
| ------------------ | -------------- | ---------------------------------------------------------------- |
| **Name**           | Yes            | One string (task title; step instruction defaults to it)         |
| **Mode**           | Yes            | Portal form · Draft email · Phone · Fax · Mail · PDF (when live) |
| **Mode config**    | Mode-dependent | See validation below                                             |
| Due offset / notes | Optional       | Collapsed notes; not a second mandatory type system              |

Map modes to stored shapes the product still stamps (do not rewrite storage in
this skill):

| Mode               | Step type                | Typical execution                    |
| ------------------ | ------------------------ | ------------------------------------ |
| Portal form        | `online_form`            | `extension_fill` when autofill is on |
| Draft email        | `draft_email`            | `manual`                             |
| Phone / Fax / Mail | `phone` / `fax` / `mail` | `manual`                             |
| PDF                | `pdf`                    | `manual` (+ mail/fax to send)        |

**Portal form mode config must include `portalKey`** (bare/normalized registry
key) when the submission path is a portal. Do not invent a portal registry row
or URL pattern — ask the human for the key / registered portal.

Prefer the Action-list mental model (one name + Mode + mode config). Do not
teach dual mandatory enums (execution type × step type) as the primary
authoring story — that is the muda the spike kills.

### 3. Validate (hard rules)

Run [references/validation-checklist.md](references/validation-checklist.md).
At minimum:

1. **Portal / autofill** ⇒ step type `online_form` + non-empty `portalKey` +
   task execution `extension_fill` (Auto-fill on for that portal action).
2. **`draft_email`** ⇒ ≥1 valid **To** recipient (literal email and/or allowed
   email-valued token such as `provider.email`). CC optional. No BCC / auto-send.
3. **Never invent `portal_field_maps`** — no selectors, tokens, hardcoded fill
   values, or fake coverage %. Capture/train/prove stays human + extension.
4. **Never call or coach publish RPCs** (`publish_sop_template_version`,
   `author_global_sop` content publish, etc.). Output is draft for human paste /
   review in the Template Editor.
5. Match-key / section-5 required attributes / go-live checklist stay advisory
   in the draft — do not flip Ready yourself.

Fail closed: if validation fails, list the failing rule and the fix; do not
hand-wave or invent missing portal keys / field maps / recipients.

### 4. Optional paste artifact

If helpful, emit **DRAFT** JSON or YAML for human paste into the editor or a
ticket — clearly labeled `DRAFT — not published`, never written into
`supabase/seed*.sql` or app source as the canonical SOP.

Suggested shape (illustrative):

```yaml
# DRAFT — human paste only; not source of truth
payer: <catalog name>
state: <XX or All when product supports>
actions:
  - name: Submit enrollment
    mode: portal_form
    portalKey: <existing_registry_key>
    autofill: true # ⇒ extension_fill
  - name: Send enrollment request
    mode: draft_email
    to:
      - source: token
        token: provider.email
    subject: "..."
    body: "..."
```

### 5. Stop

Stop after draft + validation (+ optional DRAFT artifact). The human publishes,
trains maps, and runs dry-tests per runbook §6–7.

---

## Hard refusals

| Refuse                                                                                      | Why                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventing or committing `portal_field_maps` / fill selectors / token bindings               | Maps are captured + human-approved; inventing them breaks Trust/fill                                                                                      |
| Auto-publish / calling publish RPCs / flipping template `current_version`                   | Human-in-loop only                                                                                                                                        |
| Hardcoding payer SOPs into git as canonical source of truth                                 | Catalog + versioned `sop_templates` in DB are source of truth; git seeds/fixtures are not the operator runbook                                            |
| Redefining **Ready** as published + proven (or reopening #277)                              | Locked: **Ready = checklist SOP** (≥1 active global SOP with ≥1 task). Portal train / prove / drift = soft CTAs / autofill **badges**, not the Ready gate |
| Surfacing Auto verify / Document attach as live                                             | D-SOP-2 A — hide until an engine exists                                                                                                                   |
| Rewriting `sopResolver` / generation stamping / Train dual-registry in a "setup coach" turn | Out of skill scope                                                                                                                                        |

---

## Anti-patterns

- Free-text data fields that are not closed catalog tokens
- Portal action without `portalKey`, or Auto-fill without `online_form`
- `draft_email` with empty To (or BCC / "we'll auto-send")
- Pasting a full prior payer's SOP as truth without the runbook worksheet
- Victory-claiming "Ready" because a dry-run passed — prove is a badge, not Ready
- Opening Ready / All-states / TD-42 / FormStepPanel epics under this skill

---

## Response template

```markdown
## Context

[Payer × state (± group); path: portal / email / paper]

## Draft action list

| #   | Name | Mode | Mode config | Notes |
| --- | ---- | ---- | ----------- | ----- |

## Validation

| Rule | Result | Fix if fail |
| ---- | ------ | ----------- |

## DRAFT artifact (optional)

[JSON/YAML labeled DRAFT — not published]

## Human next steps

[Template Editor paste → Review → human Publish; portal path → runbook §6 capture/train/test]
```
