# Product snapshot — enough context to write accurate wiki lines

Do **not** dump this into the user report. Use it to (1) map PRs quickly and
(2) write coordinator-language “what changed” / wiki edits without re-reading
the system map.

## What the product is

**Minted Panel** — credentialing ops SaaS for medical groups (providers, payers,
cases, SOPs/tasks, touches). Multi-tenant (`org_id` + RLS).

**Minted Panel Workbench** — MV3 Chrome extension: fills payer portal forms from
panel provider data; human submits; extension logs fill + submission touch.
Never holds service role; all data via panel `/api`.

## Sidebar IA (wiki walkthroughs = these six)

| Nav | Route (approx) | Wiki | Journey |
| --- | -------------- | ---- | ------- |
| Cases | `/cases` (Flat / By provider / By payer) | `cases.md` | D casework |
| Payer Setup | `/admin/payer-admin/setup` (+ detail/templates) | `payer-setup.md` | A readiness |
| Reporting Center | `/reporting/*` | `reporting-center.md` | reports |
| Org Detail | `/org-detail` (People + Access) | `org-detail.md` | B org |
| Groups | `/groups` → hub Facilities + Payer Network | `groups.md` | B/C network + gen |
| Providers | `/providers`, `/providers/$id` tabs | `providers.md` | B people |

Reference wiki: `data-definitions.md` (vocabulary), `where-did-it-go.md` (retired
routes / redirects).

## Vocabulary Devin must not drift

| Term | Meaning (shipped) |
| ---- | ----------------- |
| **Case** | Credentialing case at provider×group×payer×state; noun is CASE not “application” |
| **Case status** | One of eight code-owned: Not Started → In Progress → Submitted → In Review → Action Required → Approved \| Denied \| Not Pursuing |
| **Enrollment fact** | Live provider×group×payer×state enrollment (not a case); expires by flip |
| **Payer Network** | Group board of fulfillment pills derived from cases + facts |
| **Generate cases** | `/generation` confirm is the ONE create door (ManualCaseModal escape hatch) |
| **Train vs Work** | Extension modes: Train = shared forms (no org); Work = cases (org-scoped) |
| **Portal submission** | Extension touch after human submit; DB trigger can move → Submitted |
| **Field registry** | Shared/org `portal_field_maps`; only **approved** maps fill |
| **People** | Org parties + role chips; “Used on forms” = default contact for tokens |

## Extension ↔ panel (when wiki must mention both)

| Extension behavior | User-visible story | Wiki |
| ------------------ | ------------------ | ---- |
| Work handoff / fill | Open case in portal, autofill, human submits | cases + payer-setup |
| Train capture | Capture fields into shared registry for a form | payer-setup |
| Mark submitted / touch | Logs submission; may advance case status | cases + data-definitions |
| Portal recognition | Page matched via registry URL, not hardcoded list | payer-setup |

## Wiki page freshness baselines (audit-time hint)

If a merged PR clearly changes a surface but `_Updated for:` is still only the
E6 epic date below, treat as **likely gap** until proven otherwise:

| Page | Last noted in-repo header (may lag) |
| ---- | ----------------------------------- |
| cases.md | E6.3 (2026-07-19) |
| groups.md | E6.3 (2026-07-19) |
| providers.md | E6.4 (2026-07-19) |
| data-definitions.md | E6.4 (2026-07-19) |
| org-detail.md | E6.6 (2026-07-19) |
| reporting-center.md | E6.6 (2026-07-19) |
| where-did-it-go.md | E6.6 (2026-07-19) |
| payer-setup.md | E6.5 + 3M slices (2026-08-10) — fresher |

Re-read the actual file header each run; this table is a speed hint only.

## Doc vs code (do not confuse)

| Doc | Audience | Update in this skill? |
| --- | -------- | --------------------- |
| `docs/wiki/*` | Coordinators / UAT | **Yes** — primary |
| `CLAUDE.md` / `AGENTS.md` | Agents | Only if user asks |
| `docs/redesign/EX.X-*.md` | Epic specs | No (build sessions don’t edit) |
| `TECH-DEBT.md` / `DESIGN-DEBT.md` | Debt registers | Only if the PR incurred debt and missed logging |

## Human-only ops (report under Ops residual)

Hosted Supabase migration apply · SSN vault key · portal registry seed · UAT /
preview sign-off · PR merge approval. Never mark these “done” via wiki alone.
