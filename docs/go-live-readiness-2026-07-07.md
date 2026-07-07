# Go-live readiness review — 2026-07-07 (South Park Physician Group)

Compiled the morning of go-live from live sources: both repos at `main`,
the live Supabase project (MCP), Vercel deployment records, and GitHub
Actions history. Inputs: the July 6 dev guide and the roadmap doc
(`claude/minted-panel-state-roadmap-nbi4aw`).

## Verdict: GO, with one human step strongly recommended before the customer session

Everything machine-verifiable is green. The one thing this environment
cannot do is drive a real browser against the live BCBS KS portal — run
**one live fill with a test case before Sowmya's customer session** (see
"What changed since the July 6 guide" — the risk is much smaller than the
guide stated, but the DOM-selector layer still has never been exercised
end-to-end on the deployed token fix in a full form pass).

## Verification results (all evidence gathered 2026-07-07)

| Check | Result |
|---|---|
| Production deploy | `main` @ `54c73ac` (PR #41 merge), READY, aliased to mintedpanel.vercel.app / mintedpanel.com. Includes PR #37 token fix. |
| Panel: `tsc --noEmit` | Clean |
| Panel: lint | 0 errors (12 pre-existing warnings) |
| Panel: vitest | 264/264 pass (24 files) |
| Panel: `verify-isolation-local.mjs` | PASS — green on correct server, red on all 9 leak modes |
| Extension: typecheck / lint / build | All clean |
| Org-isolation gate (production) | Last run on the **current** prod deploy (run 28816515257-era series; run `28766273853`, 2026-07-06 03:42Z, sha 54c73ac) = **success**, and test-user `last_sign_in_at` timestamps confirm the verify job really ran. Nothing has deployed since. Could not re-dispatch from this session (integration lacks `actions: write`) — auto-runs on next prod deploy, or dispatch manually from the Actions tab. |
| Gate fixtures vs live | Kansas 7 / South Park 4 providers — matches workflow env. `sp_test_portal` fixture row (5a) intact. |
| Token catalog join | All 18 mapped `bcbs_ks_enrollment` tokens exist in the catalog after `normalizeTokenKey` (0 misses). |
| South Park data | Stan Marsh resolves **every** mapped token (provider 8/8, group 3/3, sole facility 7/7 — auto-selects). All 4 SP providers have NPI/CAQH/taxonomy/gender/DOB complete. 10 open cases; Stan has 2 (case dropdown works). Status tracks seeded (9 cred / 6 contracting / 7 location). Real accounts: sowmya@minted.com (admin), sowmya@fitness.fit (billing). |
| Profile READ audit | 29 `READ` audit rows in the last 48h — the R2 locked decision (one audit row per profile read) is implemented and live. **The July 6 guide's anchor 1 ("Option B, fill_sessions as sole access record") is stale** — superseded same-day by R2 decision 3, as CLAUDE.md records. |

## What changed since the July 6 guide

1. **The "token fix unverified" risk was overstated.** The guide said PR #37
   merged ~9h after the last fill. Vercel records show the prod deploy of
   `54c73ac` (which includes #37) went READY at **2026-07-06 03:42Z** — the
   last Kansas fill at **04:15Z ran after it**. That fill's skip list shows
   **zero token-join failures**: every skip is either "field not found on
   this page" (form section not in the DOM — the BCBS `.faces` form reveals
   sections progressively; all 24 maps are `page_step` null) or a genuine
   data gap / deliberate manual field. The token pipeline is verified live.
   What is NOT yet verified is a full multi-section form pass — hence the
   recommended pre-session test fill.
2. **Expected fill result tomorrow (Stan Marsh, full form):** 18 of 24
   mapped fields auto-filled (19 field instances; `group.npiType2` maps
   twice), 6 deliberately manual (office contact split, position/title,
   hours layout, subpart NPIs, telemedicine question). If you see far fewer,
   suspect the form section wasn't rendered yet — re-run the fill per
   section.

## Fixed during this review (data-only, via Supabase MCP — single portal-URL actor today, no code change needed)

1. **`portals` registry key mismatch** — the one registry row was seeded as
   `portal_key='bcbs-kansas'` / `name='bcbs_kansas'` while all field maps
   and fill sessions use `bcbs_ks_enrollment`. The Portals admin
   (`/admin/portals`) joins mapped-field counts and last-fill by
   `portal_key`, so it would have shown zero mappings and no fills.
   Updated to `bcbs_ks_enrollment` / "BCBS KS network enrollment";
   `form_url` already correct.
2. **`payers.portal_url` Availity drift** — Kansas "BCBS of Kansas" pointed
   at `https://availity.com`; now points at the real enrollment form URL
   (matches extension `urlPrefix`, manifest, and field-map `url_pattern`).
   South Park's Aetna/Anthem → Availity links are correct (those payers
   really use Availity) and were left alone.

Gate fixtures were not touched by either fix.

## Remaining human actions (cannot be done from this session)

Ordered by go-live impact:

1. **Run one live fill** on the BCBS KS form with a test case (Stan Marsh
   or a Kansas test provider) before the customer session. Expected: 18/24
   across a full pass; the "Mark submitted" touch flow should also be
   exercised once.
2. **Rotate `testsouthpark@minted.com`'s password** + update the
   `SOUTHPARK_USER_PASSWORD` repo secret, then re-run the gate (Actions →
   "Verify org isolation" → Run workflow). Note: the account currently
   holds the **admin** role in South Park (the workflow comments still say
   billing — presumably flipped so it could POST fill-events, which is
   writer-only). No gate assertion depends on the role, but decide whether
   admin is intended before rotating.
3. **Enable branch protection on `main`** in both repos (require PR +
   green checks). Not verifiable/settable from this session.
4. **Review + merge `claude/minted-panel-state-roadmap-nbi4aw`** — the
   roadmap + execution prompts (P0-a … P11). It's docs-only; the P0 tech-debt
   prompts (esp. TD-1 stale-cache and EXT-1 wrong-record-fill risks) are the
   first post-go-live work.
5. **CORS check (low risk):** fills worked July 5–6, so `API_CORS_ORIGINS`
   already admits the unpacked extension's origin — but if the extension is
   loaded on a different machine/profile tomorrow, its unpacked ID changes
   and API calls will fail preflight. Keep the same machine, or add the new
   `chrome-extension://<id>` to the Vercel env and redeploy.

## Non-blocking notes

- Supabase security advisors: 4 pre-existing WARNs for deliberately exposed
  SECURITY DEFINER RPCs (`claim_invites`, `get_sop_field_tokens`,
  `user_org_ids`, `user_role`) + leaked-password protection disabled.
  Worth a hardening pass later; none is new or go-live-relevant.
- The 24 BCBS field-map rows still store 19 tokens in braced form and all
  sit at status `proposed` with `field_label` null — served fine (the
  server normalizes; the endpoint doesn't filter on status), and the
  Mapping-review surface (`/portals/bcbs_ks_enrollment/train`) is the
  in-product way to confirm them post-go-live.
- South Park has no `portals` registry row of its own; `/admin/portals` is
  empty for them until one is added in-app. Cosmetic for tomorrow.
