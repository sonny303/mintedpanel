# Spike — SOP Tasks & steps simplification (execution type vs step type)

**Status:** spike complete (2026-08-11) — **PM ack recorded 2026-08-11:
`D-SOP-1 A; D-SOP-2 A; D-SOP-3 A; D-SOP-4 A`.** Build bites proceed from
§Untangled slices. This PR stays docs-only.  
**Branch / PR:** `cursor/sop-tasks-steps-3m-spike-4688` (#292)  
**Lane:** 3M UX / authoring muda. Skill: `.cursor/skills/minted-3m-audit/`.  
**Base:** `main` @ `013080a` (panel) / extension `cde90c2`.

Companion: [`repo-workflow.md`](./repo-workflow.md) ·
[`payer-onboarding-runbook.md`](../redesign/payer-onboarding-runbook.md) ·
[`R6-workflow.md`](../redesign/R6-workflow.md) ·
`src/lib/executionTypes.ts` · `src/components/templates/TemplateTaskRow.tsx`.

---

## Verdict

The Tasks & steps editor is **not optimized** for credentialing SOP setup. It
forces a three-level hierarchy (template → task → step) and **two orthogonal
type systems** (task **execution type** vs step **step type**) that mostly
encode the same operator intent on the common path: “fill this payer portal.”
Only Auto-fill does anything today; Auto verify / Document attach are inert
configuration. Readiness still has **two different “needs form” signals**.
Simplify to one operator-facing action model; keep the stored task/step grain
until a deliberate migration — do not rewrite generation/stamping in the first
bites.

---

## What operators are looking at (scope)

This spike is about **SOP template authoring** (Template Editor → Tasks &
steps), which is what becomes the generated case checklist. It is **not** the
`/cases` work surface — but case setup quality is gated by how usable this
authoring path is. Screenshots that motivated the review: global template
“BCBS KS for OR” v1, one task “Fill out online portal form” / Auto-fill, one
step “Fill out online form” / Online form / portal proven+broken.

---

## Canonical definitions (code-verified)

| Concept | Grain | Closed set | Job | Live effect today |
| ------- | ----- | ---------- | --- | ----------------- |
| **Execution type** | **Task** (`tasks.execution_type` + `task_definitions[].executionType`) | `manual` · `extension_fill` (“Auto-fill”) · `auto_verify` · `document_attach` | **Where the work is performed** — the entry point / automation lane at case time (`R6-workflow.md`) | **Only Auto-fill** gates form-setup / TE-16 form readiness (`hasExtensionFillTask`). Others are captured config (“no effect yet”). |
| **Step type** | **Step** (`sop_content` / `task_definitions[].steps[].stepType`) | `online_form` · `draft_email` · `phone` · `fax` · `mail` · `pdf` (disabled) | **What medium/channel the step uses** — drives step body UI, portal link, email To/CC, cadence | Online form → portal + FormStepPanel; draft email → Gmail handoff; phone/fax/mail → channel body; pdf coming soon |

Sources of truth:

- Execution: `src/lib/executionTypes.ts` (labels/hints; `hasExtensionFillTask`)
- Step: `SOPStepType` in `src/types/index.ts`; wizard select in `TemplateTaskRow.tsx`
- Intended product prose: `docs/redesign/R6-workflow.md` §SOP buildout;
  design handoff `docs/redesign/design-reference/payer-and-cases/README.md` §4
  (“Only Auto-fill changes anything today”)
- Operator runbook: `docs/redesign/payer-onboarding-runbook.md` §3–4 (asks for
  **both** columns on every task)

```text
Operator intent (happy path)
  "This payer enrolls via BCBS KS portal; fill it with the extension."

Today they must set
  Task title ≈ Step instruction ≈ Description
  + Execution type = Auto-fill
  + Step type = Online form
  + Portal = BCBS KS…
```

That is the mismatch: **one intent, five fields.**

---

## How peer products avoid this

| Product | Model | Why it feels lighter |
| ------- | ----- | -------------------- |
| **Jira** | Issue (+ optional sub-tasks). One **Issue Type** dimension; workflow is status, not a second type on every child. | Sub-tasks are opt-in detail, not required twin of every issue. |
| **ClickUp** | Task + optional checklist / nested tasks. **Custom Task Types** drive automation; checklists are not typed. | Type lives once; sub-items are content, not a second enum. |
| **Linear** | Issue; sub-issues rare. Labels/projects for routing. | Flat by default; hierarchy is opt-in. |
| **Asana** | Task + subtasks; sections group. No dual “execution × channel” enums. | Checklist items inherit parent context. |
| **ServiceNow / ITSM** | Catalog item → tasks; **fulfillment type** is one field. | Channel and automation collapse into one mode. |
| **Zapier / Workato** | Ordered **actions**; the action kind *is* the execution mode. | No parent “execution type” separate from step kind. |

**Credentialing takeaway:** treat the SOP as an **ordered list of actions**.
The action’s **mode** (portal / email / phone / …) implies how it runs.
Reserve “task groups” only when a human truly needs a multi-step checklist
under one due date (e.g. call → fax packet). Do not force a typed parent +
typed child for every one-step portal fill.

---

## 3M register (Tasks & steps / case-setup authoring)

| ID | 3M | Area | Finding | Evidence | Sev | Effort | Rec | Why it still hurts |
| -- | -- | ---- | ------- | -------- | --- | ------ | --- | ------------------ |
| SOP-TT-1 | **Mura** | panel authoring | Two type systems for one intent (Auto-fill vs Online form) | `executionTypes.ts`; `TemplateTaskRow` Execution type + Step type selects; runbook §3–4 | S1 | M | fix | Authors guess which dropdown “turns on” Workbench; wrong combo = Ready SOP that never fills |
| SOP-TT-2 | **Muda** | panel authoring | Title / description / step instruction triple for 1-step portal tasks | Screenshot pattern; wizard seeds both levels (`TemplateWizard` add task/step) | S1 | S | fix | Cognitive tax on every payer SOP; copy drift (“Fill out…” ×3) |
| SOP-TT-3 | **Mura** | readiness | Two “needs form” signals: execution_fill vs online_form step | `payerReadiness.ts` `hasExtensionFillTask` vs `payerReadinessFunnel.ts` `hasOnlineForm` / `sopOnlineFormNeeds` | S1 | S | fix | Funnel CTAs and TE-16 form readiness can disagree when Auto-fill unset but online_form present (or reverse) |
| SOP-TT-4 | **Muri** | publish | No lint: Auto-fill without online_form+portal (or online_form without Auto-fill) | `sopPublishLint.ts` — email/To only; no execution↔step coupling | S1 | S | fix | Silent misconfig; extension never tees up; form badges lie |
| SOP-TT-5 | **Muda** | panel authoring | Auto verify / Document attach offered while inert | `EXECUTION_TYPE_HINTS` “Recorded now, no effect yet” | S2 | XS | fix | Choice paralysis; looks like broken product |
| SOP-TT-6 | **Muri** | IA | Forced Task→Step tree + dual reorder chrome for the common 1:1 case | `TemplateTaskRow` task card + nested steps; design §4 still describes hierarchy | S1 | L→slices | fix | Over-architecture vs “author payer process once” (#280 intent) |
| SOP-TT-7 | **Muda** | docs | Runbook + R6 still teach both columns as first-class | `payer-onboarding-runbook.md`; `R6-workflow.md` | S2 | XS | fix | Training re-teaches the bloat |
| SOP-TT-8 | **Mura** | case UI | Case detail shows execution badge; step body is by stepType — operators never see the coupling explained | `CaseTasksPanel.tsx` labels; `StepDetails.tsx` by `stepType` | S2 | S | postpone | Secondary once authoring is fixed; don’t dual-fix case UI first |

Locked nearby (do **not** reopen in this spike): Ready = checklist SOP (#277);
autofill badges soft; form mapper stays; D3.3-G / All-states (#280); TD-42
ungated shared authoring = R7.

---

## Target model (recommended)

### Operator-facing (happy path)

An SOP is an **ordered list of Actions**. Each Action has:

1. **Name** (one string — today’s task title; step instruction defaults to it)
2. **Mode** (= today’s step type: Portal form · Draft email · Phone · Fax · Mail · …)
3. Mode-specific config (portal + form setup · email template · cadence/artifacts)
4. Optional **due offset** (days from case open)
5. Optional **notes** (collapsed; replaces always-visible description)

**Auto-fill** becomes a **derived or mode-local** flag:

- Default **on** when Mode = Portal form and a portal is linked
- Shown as a single checkbox/toggle *on that action*, not a sibling enum of Manual/Auto verify/Document attach
- Stored as today’s `execution_type = extension_fill | null` under the hood for generation/extension contracts

**Multi-step under one due date** stays supported as an advanced “Add sub-step”
(or keep nested steps in storage) — not the default empty state for a new
portal SOP.

### What stays load-bearing (Keep)

- Ordered checklist stamped onto cases (`create_case_with_tasks` / `sopStamp`)
- Portal key on `online_form` steps (extension match + close-out)
- FormStepPanel lifecycle (register → capture → map → repair → prove)
- Versioned publish (E1.7b)
- `extension_fill` wire value for E4.3 workbench / `/api/cases/:id/context`

### What to kill or hide (Kill / defer)

- Surfacing Auto verify / Document attach until an engine exists (hide or
  “Coming later” like PDF)
- Requiring a second typed layer for every single-action SOP
- Teaching two columns in the runbook as the primary mental model

---

## PM decision forks (reply with letters)

### D-SOP-1 — Collapse surface (required)

| Option | Meaning |
| ------ | ------- |
| **A (recommended)** | **Action list UX**: one row = one action; Mode dropdown; Auto-fill toggle only on Portal form. Keep task+step JSON storage; synthesize a single step when authoring 1:1. |
| **B** | Keep Task→Step hierarchy, but **derive execution type** from steps (any `online_form`+portal ⇒ Auto-fill; else Manual). Remove execution-type control from UI. |
| **C** | Keep both controls; only add lint + copy (minimal change). |

### D-SOP-2 — Inert execution types

| Option | Meaning |
| ------ | ------- |
| **A (recommended)** | Hide Auto verify + Document attach until R7/E4.5 automation ships. |
| **B** | Keep visible with stronger “no effect yet” (status quo + copy). |

### D-SOP-3 — Readiness “needs form” signal

| Option | Meaning |
| ------ | ------- |
| **A (recommended)** | One helper: form follow-ups when SOP has `online_form` **and** (Auto-fill **or** linked portal). Align `payerReadiness` + funnel. |
| **B** | Execution type only (TE-16 strict) — online_form without Auto-fill never shows form CTAs. |
| **C** | online_form only — ignore execution type for badges (execution type becomes stamp-only). |

### D-SOP-4 — Multi-step tasks

| Option | Meaning |
| ------ | ------- |
| **A (recommended)** | Advanced: “Add another step under this action” for phone→fax etc.; default new SOP = one action, one step. |
| **B** | Flatten forever: max one step per task (migrate multi-step to sibling tasks). |

**PM ack (2026-08-11):** `D-SOP-1 A; D-SOP-2 A; D-SOP-3 A; D-SOP-4 A`

Also approved: thin Cursor skill = **runbook coach / draft + validate only**
(never auto-publish, never invent field maps, never hardcode payer SOPs in git).

---

## Untangled slices (after PM ack)

### BITE-SOP-TT-01 — Lint + single “needs form” helper

- **3M:** Muri / Mura · **Repo:** panel · **Depends on:** none (safe even if D-SOP-1 C)
- **Problem:** Auto-fill ↔ online_form/portal can disagree; readiness uses two predicates.
- **Change:** `sopPublishLint` warnings/errors for mismatched pairs; extract
  `needsFormFollowUp(tasks)` used by `payerReadiness` + `payerReadinessFunnel`;
  unit tests for both mismatch directions.
- **AC:** Publish blocked or warned per PM; funnel + TE-16 agree on fixtures;
  no schema change.
- **Out of scope:** Wizard IA redesign.
- **PM decision:** D-SOP-3 (+ whether lint is hard block vs warn).

### BITE-SOP-TT-02 — Hide inert execution types + runbook truth

- **3M:** Muda · **Repo:** panel · **Depends on:** D-SOP-2 A
- **Change:** TemplateTaskRow select = Manual + Auto-fill only; update
  `payer-onboarding-runbook` + short note in R6; tests for labels set.
- **AC:** Inert types not choosable on new edits; existing stamped values still
  resolve via `resolveExecutionType`.
- **Out of scope:** Deleting DB CHECK values.

### BITE-SOP-TT-03 — Happy-path Action row (presentation)

- **3M:** Mura / Muda · **Repo:** panel · **Depends on:** D-SOP-1 A or B; prefer after 01
- **Change:** For tasks with ≤1 step, collapse UI to one name + Mode +
  mode-config + optional due offset; hide duplicate description/instruction;
  Auto-fill toggle (A) or derived (B). Multi-step tasks keep expanded UI.
- **AC:** Authoring a portal SOP requires ≤3 decisions (name, portal, autofill
  default-on); publish still stamps task+step shapes generation expects.
- **Out of scope:** Migrating jsonb shape; case-detail redesign (SOP-TT-8).

### BITE-SOP-TT-04 — Default seeds + empty state

- **3M:** Muda · **Repo:** panel · **Depends on:** 03
- **Change:** “Add portal action” / “Add email action” presets; stop seeding
  triple “Fill out online form” copy; optional remove always-on description.
- **AC:** New global payer SOP reaches Review with portal linked in &lt; N
  fields (document N in PR); e2e slice on template editor happy path.
- **Out of scope:** FormStepPanel rewrite / Train dual-registry (extension).

---

## Lanes

| Code (agentable) | Ops | Epic / R7 | Backlog |
| ---------------- | --- | --------- | ------- |
| Lint + unify needs-form helper; hide inert types; collapse 1:1 Action UI; seeds/runbook | None for this spike | Real auto_verify engine; document_attach vault pull; platform roles (TD-42) | SOP-TT-8 case-detail copy; TECH-DEBT if we open a TD row after ack |

---

## Keep / Improve / Kill

| Keep | Improve | Kill (from operator surface) |
| ---- | ------- | ---------------------------- |
| Task/step storage + stamping | One Mode + derived/local Auto-fill | Dual mandatory enums on every card |
| Portal key + FormStepPanel | Publish lint for mismatches | Auto verify / Document attach until live |
| Versioned publish | Single readiness “needs form” predicate | Triple title/description/instruction on 1-step SOPs |
| Extension `extension_fill` contract | Action presets for portal/email | Runbook teaching two columns as primary |

---

## Recommended next tranche

1. **This spike PR** — PM ack on D-SOP-1..4.
2. **BITE-SOP-TT-01** lint + readiness helper (unblocks trust immediately).
3. **BITE-SOP-TT-02** hide inert types + docs.
4. **BITE-SOP-TT-03** collapsed Action row (the UX win matching the screenshots).
5. **BITE-SOP-TT-04** presets/seeds (polish).

Stop condition for the program: a specialist can author “BCBS KS portal fill”
without setting Execution type and Step type as separate concepts, and Ready /
form badges agree with what the extension will fill.

---

## Next-agent packet (paste-ready after PM ack)

```
Mandate: SOP Tasks & steps simplification (3M).
Spike: docs/ops/sop-tasks-steps-simplification-spike.md
PM ack: <paste D-SOP-1..4>

Next BUILD: BITE-SOP-TT-01 then 02 (or 01+02 if ack is A/A/A/A).
Hot files: sopPublishLint.ts, payerReadiness.ts, payerReadinessFunnel.ts,
  executionTypes.ts, TemplateTaskRow.tsx, payer-onboarding-runbook.md
Must: additive only; keep extension_fill wire; no sopResolver rewrite;
  no Ready-gate reopen (#277); no Train rewrite.
Must-not: drop task/step jsonb in first PR; surface auto_verify as live;
  self-merge.
Stop: draft PR with AC checklist; unit tests for mismatch fixtures.
```

---

## Evidence appendix (paths)

| Claim | Path |
| ----- | ---- |
| Execution type union + Auto-fill-only hint | `src/lib/executionTypes.ts` |
| Step type select + nested steps UI | `src/components/templates/TemplateTaskRow.tsx` |
| Publish lint ignores execution↔step | `src/lib/sopPublishLint.ts` |
| TE-16 uses execution type | `src/lib/payerReadiness.ts` |
| Funnel uses online_form steps | `src/lib/payerReadinessFunnel.ts` |
| Case badge uses execution labels | `src/components/cases/CaseTasksPanel.tsx` |
| Step body switches on stepType | `src/components/cases/StepDetails.tsx` |
| Design: only Auto-fill changes anything | `docs/redesign/design-reference/payer-and-cases/README.md` §4 |
| R6: execution = entry point | `docs/redesign/R6-workflow.md` |
