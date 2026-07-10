# Minted Panel — UI kit

High-fidelity recreations of the two product surfaces, built from the same tokens and component vocabulary. These are the "real screens" that prove the system reads in context.

## Screens

- **`index.html` — Providers page.** The provider-grouped work view: dark-forest sidebar, org picker, search + filter toolbar, and expandable provider rows (one expanded to show its cases inline). The canonical full-app layout.
- **`extension.html` — Extension side panel.** The Chrome extension workbench on a ~380px surface: provider card with copyable IDs, org/case pickers, a coverage panel with a gap list, the primary "Fill form" action, and a fill-report with collapsible Filled / Skipped / Needs-a-human buckets.

Together these are the "one system, two surfaces" story: the web app and the extension are built from one visual language.

## How they're built

Both screens are static HTML that link the root `styles.css` and consume the design tokens (`var(--mp-*)`, `var(--color-*)`). They mirror the component primitives in `components/` — `Badge`, `ActionBadge`, `GroupedList`, `ProgressBar`, `CopyButton`, `FormField`, `CountBadge`. In production these compose the real React components; here they're flattened for a dependency-free preview.

## Sample data

Org **Kansas Fitness Physio** (KS / MO); providers **Brian Hershberger, PT**, **Sarah Nguyen, DPT**, **Marcus Bell, PT, DPT**; payers BCBS Kansas, Aetna, Cigna, UnitedHealthcare / Optum, Humana Military; coordinator **Sowmya**.
