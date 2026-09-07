# Client portal spike synthesis — S1, S2, S4

**Date:** 2026-09-02  
**Scope:** client owner / executive sponsor v1; provider self-view excluded  
**Decision package:** investigation complete; product decisions and hosted
revalidation remain before build

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
- Replaying checked-in migrations yields 155 public RLS policies: 145
  membership-dependent and 94 role-aware. Fifty-one SELECT policies grant
  org-wide reads based on membership without checking role.
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

| Priority | Decision/blocker                                                                                                         | Default until answered                                                                                                             |
| -------: | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
|        1 | What authoritative source maps a client to one or more groups, and who approves the initial grant?                       | No automatic access. Literal zero-manual-config onboarding is not currently achievable.                                            |
|        2 | Supabase MCP was unauthenticated, blocking hosted column parity checks and the required scratch-project benchmark rerun. | Treat repo column audit and local timings as evidence, not hosted certification.                                                   |
|        3 | What exactly makes a provider “in Raleigh”: any assignment, primary provider facility, or case primary facility?         | Any active provider-facility assignment in `facilities.city = Raleigh` is recommended.                                             |
|        4 | What exact facts make “Ready to bill” true?                                                                              | Do not display a confirmed billing date until credentialing, contract, facility, and payer effective requirements are all defined. |
|        5 | Are payer references/issued IDs, provider contacts, TIN last four, license summaries, or documents client-visible?       | No.                                                                                                                                |
|        6 | Does an active payer target without a case mean “Not started,” and is a denied case “Attention needed” or “Closed”?      | Product must set the matrix population and status semantics.                                                                       |
|        7 | How quickly must revocation take effect?                                                                                 | Resolve active grants per request; do not cache authorization across requests.                                                     |
|        8 | Can one person hold both internal and client access, or client contexts across orgs?                                     | Support explicit context choice; never union scopes automatically.                                                                 |

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

Product should answer the yes/no list in S2 and the ownership/readiness
decisions above. Then hosted operators authenticate Supabase tooling, run the
read-only production schema diff and scratch benchmark, and attach those
results to these docs. Only after that confirmation should the team draft an
epic, user stories, or build acceptance criteria.
