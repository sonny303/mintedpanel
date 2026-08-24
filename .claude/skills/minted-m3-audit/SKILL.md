---
name: minted-m3-audit
description: Lean 3M audit for a live Minted Panel feature — score it against Muda (waste), Mura (unevenness), and Muri (overburden), plus the credentialing coordinator's workflow efficiency. Invoke on "audit", "M3", "3M", "lean review", or a request to health-check an existing (already-built) feature.
---

# Minted M3 Audit: Lean Review of a Current-State Feature

Use this for a health check on an already-built, live feature — not for debugging, and not a comparison against a proposal. Scores what's live today against Lean's three wastes.

## Scope

**Input:** one current-state feature (e.g. "the case generation confirm flow" or "the touchlog panel").
**Output:** a 3M score with specific findings ranked by impact, plus a short list of what to fix first.

## The three lenses

- **Muda** — waste: steps, clicks, data, or code that add no value.
- **Mura** — unevenness: inconsistent behavior across payers, states, or screens.
- **Muri** — overburden: too much load on the coordinator or the system at once.

Work through all three — a feature can pass one lens and fail another.

## Lens 1: Muda (waste)

Check for: redundant data entry (same fact typed twice — e.g. an NPI entered on the provider form and again on a case); dead UI (buttons/fields nobody uses); duplicate data that can drift (a value stored in two tables instead of derived — Minted Panel's own rule is "derived, never stored," so a literal duplicate is a real finding); unnecessary confirmations or waits; validation running more than once on the same data; reports or exports nobody reads.

Diagnostic: walk the feature start to finish as the coordinator would. At each step ask "if this disappeared, would anything break?" If no, it's Muda.

## Lens 2: Mura (unevenness)

Check for: the same action looking or behaving differently on different screens; one payer's flow working differently from another's for no documented reason; a rushed step immediately after a slow one; readiness/validation behaving differently by state or payer with no stated reason; all the load concentrated on one screen while others are idle.

Diagnostic: compare the same feature across 2–3 payers or states (e.g. Kansas Fitness Physio vs. South Park Physician Group). Note every place behavior differs without a documented reason.

## Lens 3: Muri (overburden)

Check for: cognitive overload (too many fields/decisions on one screen); manual work a rule or default could handle; system strain (slow queries, large payloads, timeouts under normal use); error-prone steps that demand too much attention at once; no recovery path if the coordinator makes a mistake or has to step away mid-task.

Diagnostic: count the decisions/fields per screen. Ask whether a rule or default could remove each one. Check whether the feature is slow or needs a reload under normal use.

## Workflow

1. Name the feature to audit.
2. Walk Muda first — list findings.
3. Then Mura — compare across payers/states.
4. Then Muri — load and recovery check.
5. Rank all findings by impact (time cost or error rate for the coordinator).
6. Recommend what to fix first.

## Output format

```
M3 Audit: [Feature Name]

Muda (Waste)
- [finding] — [step/screen]

Mura (Unevenness)
- [finding] — [comparison]

Muri (Overburden)
- [finding] — [frequency/impact]

Top 3 to Fix First
1. [highest impact]
2. [second]
3. [third]
```

## When to call this

- A feature has been live a while and something feels clunky, but nothing's "broken."
- A coordinator reports a feature is slow, confusing, or repetitive.
- Before extending an existing screen — audit first, build on a clean base.
- Onboarding a new payer/state and you want to confirm the existing pattern is worth replicating.
