# Design-debt register

Process for shipping a component that the design system doesn't yet approve.
Devs never block on design review — every deviation instead leaves a row here.

## The rule

1. **Compose first.** If an approved primitive (or composition of them) fits, use it.
2. **If truly new:** add the stock shadcn primitive to `src/components/ui/`, styled by
   **tokens only** — no custom colors, radii, shadows, or type outside the token set.
3. **Log it below** in the same PR (component, where used, why, owner, date) and note
   it in the PR description.
4. **Design review triages the register** each cycle: `approved` (spec added to the
   design system) or `replace` (prescribed substitute + follow-up task).

An unlogged unapproved component is a review blocker; a logged one never is.

## Register

| Component | Where used | Why needed | Owner | Date | Status |
| --- | --- | --- | --- | --- | --- |
| _(example)_ popover | `reports/MatrixTab` cell detail | tooltip too small for the payer breakdown | — | — | pending review |
