# AUDIT_TODAY — Minted Panel full-app audit v3 (post-cutover)

**Date:** 2026-07-04 · **Auditor persona:** Sowmya running a real day
**Code audited:** branch tip `30cbdd4` = the PR #13 (launch pivot) merge — the latest production deploy per the brief. (Note: this repo's `main` ref is stale at `f5d511b`; the deployed history lives on the audited branch.)
**Live DB:** Supabase `fkvuhfsqcmujywzgczmc`, KFP org `20563fd6-8e95-46a0-8e1c-cb3b968b3c3d`

**Corrected live baseline (queried 2026-07-04):** 6 providers · 10 active facilities (all `is_active`) · **42 cases (32 open)** · **35 touches** (not 39) · **169 tasks** (not 198) · 6 contracts · 8 payers · 44 `status_configs` across both orgs, **0 with a NULL `action_bucket`**. The brief's 39/198 figures were already stale on audit day.

## Methodology (and its one honest limit)

The cloud sandbox blocks egress to `*.supabase.co` and to the Vercel URL, so production was not clicked directly. Instead, per the CLAUDE.md harness recipe:

- **Ground truth:** every count rebuilt in SQL against the **live** database via MCP (`execute_sql`), using the engine's exact rules read from `src/lib/actionState.ts` / `src/lib/workView.ts`.
- **Workflow verification:** the deployed code (`30cbdd4`) run locally (`npm run dev`), driven by Playwright at 1440×900, with the entire Supabase HTTP layer mocked from **fixtures exported row-for-row from the live DB** (auth, PostgREST filters/embeds, `create_case_with_tasks`, RLS write-denial emulated from `pg_policies`). **68 scripted assertions, 67 passed; the 1 failure is itself a finding (B5).** Request payloads were asserted, not just pixels.
- **Timings** below are local-dev numbers (no real network RTT). Click counts and correctness are the durable signal; add ~0.1–0.5s per round trip for production.

## Part 1 — Is the priority engine trusted? **YES on the numbers, with one rule-level false negative.**

SQL rebuild of all 42 live KFP cases vs the UI, per card, per row, per group:

| Engine state | SQL (live data) | /providers UI | /cases UI | /home UI |
|---|---|---|---|---|
| needs_action | **10** | 10 | 10 | 10 ("Needs your action") |
| blocked | 0 | 0 | 0 | (joins needs) |
| stalled | 0 | 0 | 0 | — |
| awaiting_effective | 0 | 0 | 0 | — |
| on_track | 22 | 22 | 22 | — |
| complete | 10 | (hidden from chips) | (hidden) | — |
| **Chips: All / Needs / In-prog / Awaiting** | **32 / 10 / 22 / 0** | **32 / 10 / 22 / 0** | **32 / 10 / 22 / 0** | n/a |

- **Exact match everywhere**, including per-provider rollups (Beeson 2-needs 0/2 in-network · Douek 1 0/7 · Hershberger 1 1/7 · Knapp 1 1/7 · Mowery 2 0/7 · Pollard 3 0/7), per-payer rollups (UHC "6 needs action"), group ordering (worst-first), and the chip→list contract (clicking "Needs your action 10" leaves exactly 10 rows on both pivots).
- **Cross-pivot consistency holds** — both views compute from the same data through `workView.ts`; after live mutations (status flips, task completion, case generation) all three surfaces updated **without a manual refresh** (TanStack invalidation verified).
- **All 44 `status_configs` carry an `action_bucket`** (NOT NULL, 0 unclassified). No false urgency from misconfig.
- **Follow-ups due = 0** is correct: every live `next_follow_up_date` is 2026-07-07..07-10 (future).

**The false negative (fails the letter of the trust check):** the v3 spec says *"approved with a null effective date counts [as awaiting effective], never as complete."* The code (`actionState.ts:56-63`) requires a **non-null future** date; Approved carries `action_bucket='complete'`, so **Approved + null effective date lands in Complete**. Live case hit: **Pollard/Medicare (Approved, no effective date recorded)** silently sits in Complete — nobody is chasing the effective date. Related coherence leak: Douek/Medicare (Approved, eff 2026-06-01 past) is billing per `/progress` ("Billing 1 of 6 insurers") but `/providers` shows Douek **0 of 7 in-network** because the bar counts only the literal "In-Network" label. Same provider, two different stories. → **BLOCKERS #1.**

Also live-data reality: `stalled` and `awaiting_effective` are **empty classes in production** (max silence 11 days; no future effective dates). Their logic is verified by the 19 engine unit tests and by synthetic mutation in the harness (S4 produced a real awaiting_effective), but no live case has ever exercised the stalled path. Watch it during the first live week.

## Part 2 — Day in the life (scripted, deployed code, live-data fixtures)

| # | Scenario | Result | Time (local) | Clicks | Notes |
|---|---|---|---|---|---|
| S1 | "What do I work on first?" | **PASS** | 0.4s after login | 1 | `/home` is the landing page; 10 needs-action rows, each with provider · payer · status · next-task CTA, all above the fold at 1440×900 (body 900px, zero scroll) |
| S2 | BCBS W-9: find case, log touch, flip status, set follow-up | **PASS** | 3.5s | 11 | Home → Cases → BCBS group → row → detail. Touch payload correct (`touch_type=email`, follow-up, `org_id`, coordinator); status→Waiting on Provider; `status_history` + 2 `audit_log` rows landed. No IDs copied between surfaces |
| S3 | Work everything Stalled | **PASS w/ caveat** | 2 clicks to the set | 2 | No stalled-only chip — stalled lives inside "In progress" but sorts above on-track and carries a bold "Nd silent" suffix + strong days column. Live stalled count is 0 today, so the queue is untested on real rows |
| S4 | Approval letter, effective 8/1 | **PASS** | 2.5s | 6 | Case → Change → Approved → Confirmed Effective Date (required field enforced) → Awaiting card = 1 and "eff Aug 1" suffix on Providers/Cases/Home **without manual refresh** |
| S5 | Task work inside case detail | **PASS** | 3.2s | 6 | Tasks list is gone and case detail fully absorbs it: sequential-lock complete w/ Undo toast, due dates visible, internal note saved + audited, `/tasks/$id` reachable via drawer "Open full task page" (also linked from Audit Log). No dead `/tasks` list links anywhere in `src/` |
| S6 | New location: generate its cases | **PASS w/ 1 blocker** | 1.8s | 3 | KC Racquet Club: checklist ordered pre-cred → MSO (by MSO name) → no-routing; Beeson's existing Aetna/UHC combos disabled "Case exists"; preview said "Create 2 cases" and exactly 2 RPCs fired, each with `facility_id`=location, Cigna routed `mso_id`=ASH with 4 SOP tasks. **But the Pre-Cred case seeded 0 tasks** — see B3. New-state/no-payer path degrades correctly ("No routing for this state" rows unchecked) |
| S7 | Show the practice owner where we stand | **FAIL on reachability, PASS on content** | 0.9s | n/a — **URL only** | `/progress` is in no nav and nothing links to it (B6). Content is right: "3 of 36 insurer enrollments active" reconciles with live math (In-Network ×2 + Approved-past-eff ×1, over non-pre-cred non-Not-Required cases incl. the 2 just created); zero pre-cred rows leak; "Not Required" omitted; owner-worded labels throughout |
| S8 | "Did I miss anything?" | **PASS w/ trust risk** | instant | 1 | Home needs-action read exactly 13 after the day's mutations (10 + 1 blocked + 2 new Not Started). But if the cases query *fails*, Home says **"Needs your action — clear"** and, with locations also failing, **"You're caught up."** — a false all-clear on the landing page (B2) |

## Part 3 — Anti-Excel test

- **Signal ratio:** default "All open cases" paints 32 rows of which 10 (31%) need action today — just above the 30% wallpaper line, but one click ("Needs your action") gives a 100%-signal view, and rows are severity-sorted inside every group so urgent work is at each group's top. Home is the real triage surface at 100% signal. Verdict: **not wallpaper.**
- **Scroll:** Home fits entirely above the fold at 1440×900. Providers/Cases need scrolling on "All" (32 rows) but not on "Needs your action".
- **Columns:** Payer/Provider · Credentialing · Group Contract · Last touch · Days · next-task CTA — all actioned. No candidates for deletion. The "Group Contract" cell is "–" for UHC (no contract row); acceptable.
- **Long entries:** none in list cells; notes live in detail. `/progress` truncates touch notes to first sentence ≤90 chars.
- **Cross-view coherence:** the same case carries the same engine state on all three surfaces (verified after every mutation). One leak: the **in-network progress bars** (label-match "In-Network") vs `/progress` "billing now" (Approved+past-eff counts) — Douek reads 0/7 vs "Billing 1 of 6" (folded into B1).

## Part 4 — Launch pivot: **landed clean.**

Verified against live `facilities` (the post-pivot model — the brief's checklist items referencing the `launches` table/enum audit the pre-pivot world; reconciled below):

- All 10 launch locations carry a valid location-track `status_id` (seeded 7-status set, labels match `launchLocations.ts` semantics); none stranded, none status-null in a launch view.
- Sections computed and rendered exactly: **Recently launched** = Leavenworth (Live 7/1) + Overland Park (Live 6/8, 26d — drops off in 4 days); **Pipeline** = 8 rows date-asc with no-date Prospects last. Verified in-browser row-for-row.
- Date semantics: "Target Aug 1, 2026" (Interviewing) vs "Starts Jul 6, 2026" (Ready for Launch) vs "—" (Prospect) all correct; **go-live nudge** fires exactly once (Olathe Ridgeview, Interviewing with a passed 7/1 date).
- **NEW STATE** tag: exactly one, on Pelican Athletic Club (LA — no Live location in group+state). Note the pivot redefined NEW STATE from "zero contracts in state" to "no Live location in group+state"; for current data both give the same answer.
- Home "Launches at risk": exactly the 2 within 30 days in Pending Fulfillment/Ready for Launch (West Central 1-of-9, KC Racquet 0-of-0), and it reads locations, not the legacy table.
- Soft-archive exclusion (`is_active=false`) is enforced client-side in `splitLaunchSections` (+ unit tests); all 10 live rows are active so it's not exercised by data.
- RLS on `facilities` (and the dormant `launches` table) matches the `credential_cases` pattern verbatim: SELECT org-scoped, INSERT/UPDATE `specialist|admin` only, read from `pg_policies`.
- **Legacy confirmed dormant:** `launches` (10 rows) and `providers.launch_id` (6 non-null) still exist per the additive rule; `grep` confirms **nothing reads or writes either** (`launchId` appears only as dormant type declarations).
- Generate-cases: works (S6) except the state-null template gap (B3).
- **Data-hygiene quirk:** Beeson's 2 cases point at **West Central** while his PFA assignments (written by the pivot migration) are KC Racquet + Olathe Ridgeview. KC Racquet therefore reads "0 of 0 in-network / No cases yet" while Beeson's actual cases boost West Central's denominator. Not a code bug — a migration mapping to review before demoing KC Racquet.

## Part 5 — Regression

- Add provider end-to-end: form loads, multi-step wizard, `createProviderWithDetails` writes licenses + facility assignments + audit (code-verified; billing-guard variant browser-verified in B5).
- One-off case via NewCaseModal: same `pickTemplate`/`resolveTemplate`/`createCase` path as S6 (duplicated matcher kept in sync — confirmed byte-similar); duplicate combos pre-filtered; DB unique constraint backstop returns 23505. Known wart re-confirmed, not re-flagged: NewCaseModal passes `facility: null` into `resolveTemplate`.
- Touch → append-only audit: verified live in S2 (audit insert is thrown-on-failure; RLS forbids UPDATE/DELETE on `touches`/`status_history`/`audit_log` — no such statement exists in `src/` either).
- Every final-nav route loads with real data. **Error states: only the four secondary Reports tabs have a real Retry button.** Providers/Cases/Launches show text-only "Refresh to retry" (no control); **Home, Progress, and the default Reports Contracts-matrix tab have no error state at all** (B2). Launches' `failed` flag also ignores `casesQ.isError`.
- Deleted-route check: **zero dead links.** No reference to a `/tasks` list, no TopBar anywhere in `src/`, no landing-page links. `/tasks/$id` is legitimately linked from the TaskDrawer and Audit Log.
- Console: zero app-generated console errors across both passes (the only entries are the harness-injected 500s and the billing 403). No `console.log`/`TODO` in `src/` (one sanctioned `console.error` in the root error boundary). Nothing over 1s locally.

## Part 6 — Permissions (billing pass, `sowmya@fitness.fit`)

- **DB layer: solid.** All writer tables enforce `specialist|admin` in `pg_policies`; `create_case_with_tasks` is SECURITY INVOKER (RLS applies inside); billing INSERT attempts 403 with `42501`. Verified live-shape in the harness: the billing create attempt failed and **zero rows were written**.
- **UI layer: two holes, both deep-link shaped:**
  1. `/launches/$id?createCases=true` auto-opens the Create Cases dialog for a billing user — full payer checklist, live "Create 2 cases" button; clicking yields only a raw "Case creation failed" toast (screenshot captured). **B4.**
  2. `/providers/new` (and `/providers/$id/edit`) `beforeLoad` guards are **no-ops on direct URL load**: they read the Zustand role synchronously before memberships have loaded (`role=null`, and the guard is a deny-list `role === "billing"`), so a billing user gets the entire Add Provider wizard (10 form controls rendered — screenshot). **B5.**
- Everything else held: no New Provider/New Launch buttons, no kebab, nudge degrades to plain text, Add touch/Change status hidden, task circles disabled, admin routes show a read-only banner (by URL, no redirect — acceptable but weaker than a guard), `/home` and `/progress` render correctly for billing.
- Service layer never checks role — authorization is UI gating + RLS only. RLS is the reason these two holes are trust/UX failures rather than data breaches.

## Part 7 — Code, security, fence

- **Gates green:** `tsc --noEmit` clean · eslint 0 errors (12 warnings, all pre-existing react-hooks/fast-refresh) · **55/55 unit tests** · `vite build` clean.
- Env & secrets: `externalClient.ts` reads `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (nothing hardcoded — **AGENTS.md §Supabase-client-rule is stale**, it still claims hardcoding); service-role key only in `client.server.ts` (process.env) and the `invite-member` edge function (Deno.env, admin-gated). No `eyJ…` literals in `src/`.
- Org scoping: every service read/insert/update pins `org_id` from `requireActiveOrg()`; inserts spread `org_id` **after** the payload so a caller-supplied value can't win. Sole exception: `tablePrefs.ts` (user-scoped by design — and dead, see below).
- PHI: `ssn_last4` only, regex-gated, masked display; `PROVIDER_LIST_COLUMNS` excludes DOB/home address/SSN/malpractice. Held.
- Layering: 4 violations calling Supabase outside services — `routes/admin.templates.$id.tsx` (rpc), `routes/welcome.tsx` (auth+rpc), `components/settings/MembersPanel.tsx` (functions.invoke), `components/cases/NewCaseModal.tsx` (3 org-scoped reads). All `.rpc` calls properly bound.
- Fence: no unsanctioned schema drift found; the launch pivot (PR #13) is the only recent DDL and is sanctioned. Repo `supabase/migrations/` remains a partial mirror (known).
- **Orphan confirmed:** `user_table_prefs` (2 rows) + `src/services/tablePrefs.ts` have **zero consumers** since M6 deleted the Tasks list. Dead schema + dead service. **B8.**
- Supabase advisors: `rls_auto_enable()` is SECURITY DEFINER and **executable by `anon`** (revoke); leaked-password protection disabled. **B7.** (`user_role`/`user_org_ids`/`claim_invites`/`get_sop_field_tokens` definer warnings are by-design for RLS helpers.)

## Risk register — what shipped un-gated (nothing "not built"; everything is live)

| Risk | Severity | Where |
|---|---|---|
| False all-clear on Home when queries fail; no error state on Home/Progress/Reports-Contracts | High (trust) | B2 |
| Approved+null-eff classified Complete (live case exists); in-network bar vs "billing now" disagree | High (trust) | B1 |
| State-null SOP templates (Medicare, both Pre-Cred) never seed tasks in either creation flow | High (workflow) | B3 |
| Billing deep-links reach write UIs (RLS backstop holds) | High (security posture) | B4, B5 |
| `/progress` unreachable from the product | Medium (workflow) | B6 |
| `stalled`/`awaiting_effective` never exercised by live data; follow-up discipline is 3 bulk-logged touch dates | Medium (trust, data) | watch week 1 |
| Beeson cases↔assignments location mismatch from pivot migration | Low (data hygiene) | Part 4 |
| Dead `user_table_prefs`/`tablePrefs.ts`; AGENTS.md staleness; 4 layering violations; anon-executable definer fn | Low (code) | B7, B8 |

## Part 8 — Verdict

1. **Engine trusted?** **Yes** — every live count reconciles exactly across SQL, /providers, /cases, and /home, before and after mutations, with no manual refresh. One rule-level false-negative class (Approved + null effective date → Complete; live case Pollard/Medicare) must be patched to meet the spec's own bar.
2. **Whole day without Excel?** **Yes for S1–S6 and S8** (all under the pass bars, low click counts, no cross-referencing). **S7 fails on reachability** — Client Progress exists but isn't linked; today Sowmya would screen-share a URL she has to remember. Fix-before-Jul-17: B6 (one nav line). The rest of the day never made me do Excel work.
3. **Launch pivot clean?** **Yes** — sections, dates, tags, nudges, readiness, and generate-cases all verified against live data and asserted request payloads; legacy tables dormant. One blocker rides the flow: pre-cred/Medicare cases generate **zero SOP tasks** (B3) — that silently recreates the "checklist lives in Sowmya's head" problem for exactly the payers that need process most.
4. **Permissions hold?** **At the database, yes — completely.** At the UI, two deep-link holes show write surfaces to billing (both end in DB 403s). Fix-before-Jul-17 as defense-in-depth + trust (B4, B5).
5. **Jul 17: ON TRACK, conditional.** Five small patches clear every blocker (all UI-layer except one SQL revoke): B1, B2, B3, B4/B5, B6. **The single most dangerous blocker is B2** — the landing page answers "you're caught up" on any failed fetch, and fix-forward-with-no-fallback means a bad deploy or a Supabase blip turns into silently skipped work on a Monday morning. The smallest patch that clears it is ~15 lines: an `isError` branch on `home.tsx` (and `progress.tsx`) that says "Couldn't load — retry" instead of "clear".

---
### Appendix — evidence inventory
- SQL rebuild + per-case classification table: reproducible via MCP `execute_sql` (queries embedded in session log; engine rules mirrored from `actionState.ts` at `30cbdd4`).
- Browser harness: Playwright vs `npm run dev`, Supabase mocked from live-row fixtures (auth/PostgREST/RPC/RLS emulation per `pg_policies`), 68 assertions incl. request-payload asserts; screenshots for Home/Providers/Cases/case detail/Launches/Progress, the two billing holes, and the three error-state probes.
- Role ground truth: `test@minted.com` = KFP+SP admin; `sowmya@fitness.fit` = KFP billing; `sowmya@minted.com` = admin both (memberships table, live).
