# 09 — Design tokens

Authoritative. Prefer these over anything sampled from a screenshot.

## Token set

```css
:root {
  /* Brand */
  --mp-primary:        #1B4D3E;
  --mp-primary-hover:  #163F33;
  --mp-forest:         #0C2A1D;   /* dark chrome, sidebar, dark offer cards */
  --mp-mint:           #C8DBD4;   /* on-dark accent, primary-on-dark button */

  /* Surfaces */
  --mp-bg:             #FDFDFC;   /* panel + page background (warm) */
  --mp-surface:        #FFFFFF;   /* cards, inputs */
  --mp-muted:          #F5F4F1;   /* hover, chip, disabled */
  --mp-tint-success:   #F7FAF8;   /* confirmation cards, copied rows */
  --mp-desk:           #F1EFEA;   /* prototype page background only — not in product */

  /* Borders */
  --mp-border:         #E8E5E0;
  --mp-border-soft:    #F5F4F1;   /* row dividers */
  --mp-border-strong:  #C9C5BE;   /* unchecked control outline */

  /* Ink */
  --mp-ink:            #1F2937;
  --mp-ink-muted:      #6B7280;
  --mp-ink-subtle:     #9CA3AF;

  /* On dark */
  --mp-on-dark:        #FFFFFF;
  --mp-on-dark-body:   #D7E2DC;
  --mp-on-dark-muted:  #A7B5AD;   /* nav ink, sign-out */
  --mp-on-dark-subtle: #6E8478;   /* eyebrow labels */

  /* Semantic */
  --mp-success-bg:     #E7F5EF;   --mp-success-ink: #047857;
  --mp-info-bg:        #E8EEFD;   --mp-info-ink:    #1D4ED8;
  --mp-info-border:    #CBD9F7;
  --mp-warn-bg:        #FEF3C7;   --mp-warn-border: #FDE68A;  --mp-warn-ink: #92400E;
  --mp-amber-bg:       #FBF0E1;   --mp-amber-border: #EADFC4; --mp-amber-ink: #B45309;
  --mp-danger-bg:      #FEF2F2;   --mp-danger-border: #FCA5A5; --mp-danger-ink: #B91C1C;

  /* Radius */
  --mp-radius-control: 4px;
  --mp-radius-card:    6px;
  --mp-radius-shell:   8px;

  /* Focus */
  --mp-focus-ring:     0 0 0 2px rgba(27, 77, 62, .18);

  /* Type */
  --mp-font:           'Geist', system-ui, -apple-system, sans-serif;
  --mp-font-mono:      'Geist Mono', ui-monospace, monospace;
}
```

`--mp-desk` is the prototype's page background so panels read as objects on a desk. It has no product equivalent — do not ship it.

## Semantic usage

| Pair | Used for |
| --- | --- |
| success | Submitted/Approved pills · `THIS PAGE` chips · confirmation cards · copied rows · verified values |
| info | In Progress pill · CAQH context |
| warn | duplicate-work guard · overdue · drift banner |
| amber | absent values · unknown-form `NEW` chip · proposed mappings · unmatched labels · stale values |
| danger | Denied pill · sign-in errors · broken mappings |

Never use danger for an absent value. "Not on file" is a state, not an error.

## Type scale

| Size / weight | Use |
| --- | --- |
| 24 / 600, `-.015em` | page title (app) |
| 22 / 600, `-.015em` | prototype page title |
| 17 / 600 | section heading |
| 15 / 600 | card title, seam title |
| 14 / 600 | subsection, tab-body title |
| 13.5 / 600 | panel card title, offer title |
| 13.5 / 400 | body |
| 13 / 400–500 | dense body, buttons, step labels |
| 12.5 / 400 | secondary body, row labels |
| 12 / 400 | meta, sub-lines |
| 11.5 / 400 | fine print, footnotes |
| 11 / 600 uppercase `.06em` | eyebrow label |
| 10.5 / 600 | status pill, chip |
| 10 / 600 uppercase `.07em` | micro-eyebrow (group headers) |

Titles carry `letter-spacing: -.015em`; uppercase labels carry positive tracking.

**Mono** (`--mp-font-mono`) for every identifier, value, date, and code-ish string: NPI, TIN, CAQH, license numbers, references, payloads, file paths. Never for prose.

**`font-variant-numeric: tabular-nums`** on any container showing IDs, counts, or dates.

**`text-wrap: pretty`** on every multi-line explanatory string.

## Spacing scale

`4 · 5 · 6 · 7 · 8 · 9 · 10 · 11 · 12 · 13 · 14 · 16 · 18 · 20 · 22 · 26`

| Context | Value |
| --- | --- |
| Panel horizontal padding | 14 |
| Panel card padding | 11–14 |
| Between panel blocks | 11–13 |
| Between field groups | 14 |
| App page gutters | 24–32 |
| App card padding | 16–22 |
| Row gap in a list | 8 (queue) · 0 with dividers (values, steps) |

Always `gap` on a flex/grid parent — never per-element margins for sibling spacing. Gap survives drag-reorder and delete; whitespace text nodes don't.

## Control sizes

| Control | Height |
| --- | --- |
| Input / select — panel | 34 |
| Input / select — app dialog | 36 |
| Primary button — panel offer | 34 (full width) |
| Button — standard | 32 |
| Button — inline / small | 30 |
| Icon button | 26 |
| Avatar | 26 |
| Chip / pill | 19–21 |
| Checkbox — step | 16 |
| Checkbox — picker row | 15 |
| Row — value | 34 min |
| Row — picker field | 32 min |
| Group header — picker | 34 |
| Segmented tab | 30 |
| Progress bar | 4 |

Mobile hit targets never below 44 — not applicable in the panel, but relevant if this ever ships to a phone.

## Interaction states

| State | Treatment |
| --- | --- |
| Hover — row | `--mp-muted`, or `--mp-tint-success` on a copyable value row |
| Hover — card | `border-color: --mp-primary` |
| Hover — icon button | `--mp-muted` |
| Hover — primary button | `--mp-primary-hover` |
| Focus | `1px solid --mp-primary` + `--mp-focus-ring` |
| Active tab | `inset 0 -2px 0 --mp-primary`, ink `--mp-primary` |
| Active nav (app sidebar) | `rgba(255,255,255,.10)` + `inset 2px 0 0 --mp-mint` |
| Disabled | `--mp-muted` background, `--mp-ink-subtle` ink, `cursor: default` |
| Done / complete | `--mp-ink-subtle` ink + `line-through` |
| Copied | `--mp-tint-success` row + `--mp-primary` check, persists for the session |

**Disabled-but-explanatory:** when a primary action is unavailable, the label says what's missing ("Send 18 — assign the gap first") rather than just greying out. A disabled button with no reason is a dead end.

## The extension's current values, for the migration

Legacy aliases must keep resolving during E1.2. Mapping:

| Legacy | New |
| --- | --- |
| `#164A2F` | `--mp-primary` `#1B4D3E` |
| `#F5F6F5` | `--mp-bg` `#FDFDFC` |
| `#E5E8E6` | `--mp-border` `#E8E5E0` |
| `#EFF1EF` | `--mp-muted` `#F5F4F1` |
| `#182B20` | `--mp-ink` `#1F2937` |
| `#5B6B60` | `--mp-ink-muted` `#6B7280` |
| `#99A49B` | `--mp-ink-subtle` `#9CA3AF` |
| `#2F6B4A` (sign-out on dark) | `--mp-on-dark-muted` `#A7B5AD` |

Also drop: `shadow-sm` on controls, `999px` pill radius, 8px card radius, and the 2px solid focus outline.
