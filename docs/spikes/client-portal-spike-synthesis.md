# Client portal spike synthesis — S1, S2, S4

**Date:** 2026-09-02 (hosted-verified same day)  
**Scope:** client owner / executive sponsor v1; provider self-view excluded  
**Decision package:** investigation complete and verified against the live
database; product decisions remain before build

## Hosted verification summary

The spike was written without database access, so its live counts came from the
brief and its RLS analysis came from replaying checked-in migrations. All of it
has since been re-queried against hosted `fkvuhfsqcmujywzgczmc` with read-only
SQL. No data was written.

**The structural work held up completely.** Every RLS number, every column
count, and every cardinality reproduced exactly:

| Claim                                               | Hosted result      |
| --------------------------------------------------- | ------------------ |
| 155 public RLS policies, split 58/46/37/14          | Exact match        |
| 145 membership-dependent, 94 role-aware, 10 neither | Exact match        |
| **51 role-agnostic SELECT policies, 0 non-SELECT**  | **Exact match**    |
| 62 public tables                                    | Exact match        |
| 378 columns across 23 tables                        | Exact match, 23/23 |
| 3 orgs, 7 groups, 6 memberships all admin           | Exact match        |
| Four-part case key with `NULLS NOT DISTINCT`        | Confirmed          |
| Benchmark harness mirrors hosted indexes            | Confirmed faithful |

That is unusually clean, and it means the migration replay is a trustworthy
proxy for hosted going forward. The architecture recommendation (option B,
API-only client access, no `memberships` row) is **unchanged and strengthened**.

**Three things hosted exposed that the repo could not show**, all of which
change build scope rather than architecture:

1. **The matrix cell grain is not one-to-one with cases.** Rows = provider,
   columns = payer, over a _set_ of granted groups, is not the case key. A real
   hosted provider has two live cases with one payer in two states with two
   different statuses. Correctness bug, present today at 21 providers, blocks
   the DTO shape. See S4.
2. **The forecast the portal exists to deliver has almost no data.**
   `expected_effective_date` is populated on 0 of 42 cases, `contracts` is
   empty, `enrollment_facts` has 2 rows. "When can I bill" is unanswerable from
   today's data. See S2.
3. **The column audit classified a dead table and missed the live one.**
   `case_generation_exclusions` is empty; `case_generation_run_rows` holds the
   127-row disposition ledger. See S2.

One security finding surfaced that is **not a portal design question** and is
tracked separately in
[`docs/security/authenticated-rpc-grant-review.md`](../security/authenticated-rpc-grant-review.md).
It is a pre-req for any surface that hands Supabase tokens to people outside
the company.

## Outcome

The three spikes converge on one viable architecture:

1. **Identity/scope (S1):** retain Supabase Auth identities, but authorize
   clients through new service-only access records and explicit provider-group
   grants. Do not add a client role to `memberships`.
2. **Data boundary (S2):** expose dedicated API DTOs from a positive field
   allowlist. Of 378 audited columns across 23 relevant tables, 70 are
   potentially visible, 21 may contribute only through masking/derivation, and
   287 are never returned.
3. **Scale (S4):** do not ship an unbounded 3,000 × 20 grid. Use server-side
   filters, 50-provider cursor pages, a normalized payload, one-provider
   drill-down, and row virtualization.

The 3,000-provider promise is supportable only as that paged/virtualized
experience. The literal single-request/single-DOM grid is disproved.

Detailed decisions:

- [S1 identity and scope](./S1-client-identity-scope.md)
- [S2 client-safe data surface](./S2-client-safe-data-surface.md)
- [S4 matrix scale proof](./S4-matrix-scale-proof.md)

## Dependency and build order

Investigation can run in parallel, as the briefs state. Implementation cannot.

```text
Product confirms client→group ownership and invite owner
  → S1 access/grant schema + authenticateClient() + isolation tests
    → S2 DTOs + status/readiness derivation + privacy contract tests
      → S4 paged matrix queries + cursor contract + virtualized UI
        → client journey design and e2e/accessibility verification
```

Why:

- S2 cannot safely query until S1 supplies a server-trusted group set.
- S4's cursor and SQL must paginate the S2 DTO, not internal case/task rows.
- UI design before these contracts would optimize an unsafe and unbounded data
  shape.

## Confirmed facts

- Current API authorization resolves exactly one org membership; no group-
  scoped context exists.
- Hosted carries 155 public RLS policies: 145 membership-dependent and 94
  role-aware. Fifty-one SELECT policies grant org-wide reads based on
  membership without checking role. Migration replay and hosted agree exactly.
  Those 51 sit on 51 distinct tables and include `memberships`, `profiles`,
  `pending_invites`, `provider_ssn_intake_links`, and `party_capture_links`, so
  option A would expose staff identity and pending-token inventory, not just
  business data. See S1.
- Billing is write-restricted by RLS/API checks, but generally reads the whole
  org. It is not a client-safe role.
- Existing provider detail, case context, tasks/touches, document signing, and
  audit reads are too broad for a client.
- Provider/group cardinality is many-to-many. `providers.group_id` is a frozen
  primary mirror.
- Case grain is provider + group + payer + state, not the three-part grain in
  the S4 brief.
- The current internal matrix combines eight whole-org query families and
  renders all rows.
- At 3,000 providers/60,000 cases locally:
  - full SQL read: 233.8 ms API-bypass p95 and 242.4 ms current-RLS p95;
  - raw denormalized payload: 44,456.5 KiB;
  - existing pure derivation: 543.9 ms p95;
  - optimistic all-row DOM render: 1,721.4 ms p95;
  - 50-provider page: 11.0 ms RLS p95, 741.0 KiB raw, and 35.1 ms optimistic
    render p95.

## Recommendations

- Create a distinct `/api/client/*` namespace and client guard. Existing
  extension contracts stay unchanged.
- Resolve grants on every request from verified user identity; never trust
  group IDs or authorization claims in user metadata.
- Keep person-level responses `no-store`, never log bodies, and scope every
  joined service-role query independently by org and granted group.
- Derive a closed client vocabulary: Not started, Preparing, With payer,
  Attention needed, Approved/waiting to start, Ready to bill, Closed.
- Treat “Ready to bill” as a date-aware multi-table derivation, never a stored
  flag.
- Use facility geography for “Raleigh”; do not expose or filter on provider
  home address.
- Return provider and payer labels once per page rather than repeating them in
  every cell.
- Do not introduce a materialized view until hosted/concurrent measurements
  show the database, rather than payload/browser work, is the limit.

## Unresolved decisions and blockers

| Priority | Decision/blocker                                                                                                                                                                                                                                                                                   | Default until answered                                                                                                               |
| -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
|        1 | What authoritative source maps a client to one or more groups, and who approves the initial grant?                                                                                                                                                                                                 | No automatic access. Literal zero-manual-config onboarding is not currently achievable.                                              |
|        2 | **RESOLVED.** Hosted column parity, RLS classification, and cardinality all verified 2026-09-02 and matched exactly. Only the regional timing rerun on the scratch project remains, and it is low priority at 21 live providers.                                                                   | None. Treat the schema analysis as certified.                                                                                        |
|       1= | **NEW, BLOCKING.** A `(provider, payer)` cell can hold more than one case when the grant spans groups or a provider spans states. Proven on hosted.                                                                                                                                                | Section the client matrix by (group, state) as the internal matrix already does. Do not resolve it in the UI.                        |
|       1= | **NEW, BLOCKING.** The forecast columns are effectively empty on hosted, so a "when can I bill" surface would show unknown everywhere.                                                                                                                                                             | Ship a status-only v1. Sequence coordinator date-capture before any forecast surface.                                                |
|        3 | What exactly makes a provider “in Raleigh”: any assignment, primary provider facility, or case primary facility?                                                                                                                                                                                   | Any active provider-facility assignment in `facilities.city = Raleigh` is recommended.                                               |
|        4 | What exact facts make “Ready to bill” true? **Narrower than first written:** the facts already have columns (`expected_effective_date`, `confirmed_effective_date`, `contract_executed_date`, `contracts.effective_date`, `facilities.effective_date`). Only the boolean combination is undecided. | Do not display a confirmed billing date until the combination is agreed. Note this is moot for v1 while the columns are unpopulated. |
|        5 | Are payer references/issued IDs, provider contacts, TIN last four, license summaries, or documents client-visible?                                                                                                                                                                                 | No.                                                                                                                                  |
|        6 | Does an active payer target without a case mean “Not started,” and is a denied case “Attention needed” or “Closed”?                                                                                                                                                                                | Product must set the matrix population and status semantics.                                                                         |
|        7 | How quickly must revocation take effect?                                                                                                                                                                                                                                                           | Resolve active grants per request; do not cache authorization across requests.                                                       |
|        8 | Can one person hold both internal and client access, or client contexts across orgs?                                                                                                                                                                                                               | Support explicit context choice; never union scopes automatically.                                                                   |

## Contract, data, and privacy risks

1. A `client` membership would inherit 51 role-agnostic org SELECT policies,
   including PHI/internal tables.
2. Reusing `GET /api/providers/:id` would expose DOB, SSN last four, home
   address, DEA/CAQH data, and other disallowed fields.
3. Reusing case context would expose internal SOP steps, notes, touches, and
   coordinator identity.
4. A root-only org predicate is insufficient under the service role; embeds and
   secondary reads need their own org/group predicates.
5. UI-only filtering of test/reference/terminated/unverified rows leaks data
   through payloads and aggregate counts.
6. A forecast without freshness and unknown-date handling presents false
   precision.

## Experience states the briefs did not fully specify

### Loading

- Preserve scope and filters during cursor transitions.
- Use a structural grid/list skeleton and an accessible live loading message.
- Never replace a previously loaded cohort with apparent zeroes.

### Empty

Use different messages/actions for:

- no client grants;
- granted groups with no active providers;
- providers but no payer targets/cases;
- no rows matching filters;
- all rows excluded as non-real/unverified.

### Error and revoked access

- A revoked/expired grant is an access state, not a retryable network error.
- Partial summary/facet failure must not render zero or “ready.”
- Retry keeps the cursor, filters, and selected group.

### Accessibility

- Status text accompanies color.
- Every matrix cell names provider, payer, and status.
- Focus survives virtual-row recycling.
- Keyboard navigation and a non-grid provider list/drill-down are required.

### Responsiveness

- On narrow screens, make provider list/drill-down primary and the 20-column
  matrix secondary. Do not compress columns below readable/touchable sizes.

### Coordinator workflow and executive usefulness

- The client must see a safe “Attention needed” signal without raw internal
  notes/tasks. Product should decide whether coordinators can author a separate
  sanitized client action summary.
- Show cohort denominator, ready count, attention count, unknown count, and
  expected/confirmed date distinction before the matrix.
- Make filter state URL-addressable for review meetings.
- Show “data current as of” and never turn a missing date into zero days.

## What was missed

- Client invite/claim, expiry, replay, removal, and last-access-owner behavior.
- Mixed internal/client identity entry routing.
- Authorization-cache/revocation SLA.
- Cross-org clients and whether group sets may span orgs.
- Safe export rules; exports must use exactly the same DTO allowlist and scope.
- Access telemetry versus append-only business audit behavior.
- Realistic concurrency and remote PostgREST/TLS measurements.
- The canonical case-status history table and current four-part case grain.
- `verification_state = pending_verification` as a mandatory non-real-row
  exclusion.
- Forecast confidence/unknown semantics and the business definition of
  readiness.

## Next step

The read-only hosted schema diff is done and attached above. What remains is
product, in this order:

1. **Decide the cell grain** (blocking, and cheapest to answer: section by
   group and state, matching the internal matrix).
2. **Decide whether v1 forecasts at all**, given the empty date columns. If
   yes, the date-capture workflow change is sequenced first and it is a
   coordinator process change, not engineering.
3. **Answer the S2 yes/no list** and the client-to-group ownership question,
   which is still the one thing that makes zero-touch onboarding impossible.
4. **Clear the RPC grant pre-req** tracked in
   [`docs/security/authenticated-rpc-grant-review.md`](../security/authenticated-rpc-grant-review.md)
   before any external token is issued.

The scratch-project timing rerun is no longer a gate. It is worth doing before
a 3,000-provider customer signs, not before an epic is written.

Only after 1 through 3 should the team draft an epic, user stories, or build
acceptance criteria.
