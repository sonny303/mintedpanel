# H10 staging Vercel identity and provider seam

**Status: code preparation only. Hosted staging delivery remains blocked.**

This slice prepares the dedicated staging Vercel adapter for the installed
P05/P06 handoff. It does not activate `scripts/delivery/cli.mjs staging`, deploy,
move a domain, install a Chrome extension, or satisfy recovery/database gates.

## Requirements

| ID   | Requirement                                                                                                                                                                                             | Evidence                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| HV-1 | Accept one actual unpacked Chrome ID matching `[a-p]{32}`. Never derive, default, or substitute an ID.                                                                                                  | `staging-vercel.test.mjs` invalid-ID cases    |
| HV-2 | Use that same value for `VITE_MINTED_EXTENSION_ID` and `chrome-extension://<id>` in `API_CORS_ORIGINS`.                                                                                                 | One batch-upsert request assertion            |
| HV-3 | Change only those two project variables, both with `target: ["preview"]`, no branch selector, no custom environment, and no shared-variable inheritance.                                                | Request body and full inventory readback      |
| HV-4 | Keep the fixed team, project, staging Supabase ref, disconnected Git state, fixed aliases, no automation bypass, and Vercel Authentication on generated Preview URLs.                                   | Readiness normalization and drift tests       |
| HV-5 | Upload only the twice-admitted `staging` source and keep stable domains withheld on candidate creation.                                                                                                 | Existing source/file-tree and candidate tests |
| HV-6 | Expose provider-only snapshot, identity transition, candidate check, build, and alias methods for the later reviewed recovery integration. Provider readbacks are not G0 database or recovery evidence. | Closed service-surface test                   |
| HV-7 | Keep the hosted CLI fail-closed until the recovery owner lands real export, restore, schema, and compatibility services and a later integration PR binds them.                                          | Existing `HOSTED_ACTIVATION_BLOCKED` tests    |

## Fixed identities

| Item                      | Value                                                                       |
| ------------------------- | --------------------------------------------------------------------------- |
| Repository                | `sonny303/mintedpanel`                                                      |
| Team                      | `team_230fpJ9MgCj9ssW3LiIckfyA`                                             |
| Project                   | `prj_1t7NkRJMkjTuFXEBEP4GjfN4B6Ch` (`mintedpanel-staging-web`)              |
| Vercel environment        | Preview only                                                                |
| Supabase                  | `vmznysvietfaddakkegt`                                                      |
| Web origins               | `https://staging.mintedpanel.com`, `https://mintedpanel-staging.vercel.app` |
| Candidate domain behavior | Generated Preview URL remains protected; stable aliases are withheld        |

## Mutation and rollback record

| Phase              | Required before                                                                                       | Mutation                                                             | Verified after                                                                            | Rollback boundary                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Extension identity | Merged web and extension SHAs, actual Chrome ID, reviewed provider code, fresh fixed-project snapshot | One Vercel batch upsert for the two Preview variables                | Complete eight-variable inventory, exact ID/CORS pair, unchanged fixed project/protection | Restore the captured prior pair through the reviewed integration; no later deployment consumes a failed readback |
| Candidate          | Exact admitted `staging` source, identity readback, no active/competing deployment                    | Content-addressed upload and Preview creation without a stable alias | Deployment source/config metadata and complete provider file tree                         | Leave stable aliases on their captured deployment; retain the candidate for diagnosis                            |
| Stable aliases     | Recovery and runtime gates from the later integration PR, candidate recheck                           | Secondary staging alias first, primary staging alias last            | Per-alias deployment readback plus hosted health/compatibility evidence                   | Reassign each alias to its captured prior deployment; a partial/uncertain write retains the shared lease         |

An environment-variable edit changes only future deployments. A candidate is
never treated as configured from the write response; the adapter re-reads the
complete project inventory. Any uncertain provider write must retain delivery
ownership for reconciliation.

The provider-only snapshot accepts the exact legacy no-ID inventory or one
internally aligned current ID/CORS pair. It reports that identity without
environment values so the later integration can bind rollback evidence. The
explicit identity-transition service returns sanitized before/after readbacks
and both configuration digests. Build is pure with respect to project settings:
it rejects until the requested identity and complete eight-variable inventory
already exist.

## Current external baseline

The 2026-09-19 UTC read-only snapshot found seven Preview variables before the
Chrome ID is known, no shared variables, Git disconnected, Standard Protection
with Vercel Authentication, and no custom staging aliases on the dedicated
project. Public requests to both intended staging aliases reached Vercel login;
the dedicated generated domain returned `DEPLOYMENT_NOT_FOUND`. The exact prior
alias project/deployment IDs must be collected again through the reviewed
provider path immediately before mutation and bound into rollback evidence.

P05 is currently merged only on application `staging` at
`ad25c8cc135aea1eb79127b1af34367ccaceec13`. The successful-current-main source
admission rule remains binding, so that SHA is not deployable through this
adapter. A separately reviewed staging-to-main promotion and successful final
main CI are required before the delivery controller can admit the application
source. The provider control code remains based on and targeted to `main`.

## Remaining integration gate

The later integration PR must import this fixed provider seam directly and bind
it to the recovery owner's authenticated services. It may not accept a local
PASS file, provider module path, target/project override, saved receipt, or a
Production command. Only that integration may remove blockers proven by both
service implementations and their hosted denial/readback evidence.

That integration must also model the approved configuration transition under
the shared lease and bind the after-digest into the immutable target record
before invoking build. The current controller binds one preflight
`targetConfigurationDigest`; it cannot treat a later digest as the same target.
This provider PR deliberately does not change that controller contract or hide
the transition inside build.
