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

| Component / deviation                | Where used                                      | Why needed                                                                                                                                                                                                                                                                                               | Owner | Date       | Status         |
| ------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------- | -------------- |
| Toast keeps `shadow-lg` (spec: none) | `src/components/ui/sonner.tsx`                  | E0.9 internal conflict: F0.9.2's AC and the token sheet keep the toast's soft shadow ("floating overlays keep theirs"; `--mp-shadow-lg` is annotated "toast"), while the reference `Toast.jsx` says border-only. Border + white surface + 6px radius applied; the shadow stayed pending a design ruling. | PM    | 2026-07-10 | pending review |
| Switcher "recents" = active org only | `src/components/layout/Sidebar.tsx` (100+ orgs) | The 100+-org recents-only rule needs a recency signal the app doesn't track; the only known-recent org today is the active one, so the list shows it plus search. Revisit when a customer nears that scale.                                                                                              | PM    | 2026-07-10 | pending review |
