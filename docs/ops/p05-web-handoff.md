# P05 web-to-extension handoff work order

## Scope and ownership

| Item         | Contract                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source       | Audit Session #19; `context/minted-p05-p06-kickoff-2026-09-18.md` H1–H10                                                                               |
| Base         | Panel `staging` at `dffc60a322da8f233fce2ab097629abbcf9ef4b9`                                                                                          |
| Owner        | P05 web writer; P06 owns extension receiver/runtime changes after this wire contract settles                                                           |
| Mounted path | `/cases/$id` → `CaseTasksPanel` → `TaskDrawer` → active `online_form` `StepBody` → `PortalStepLink` → `WorkInPortalButton`                             |
| Included     | Addressed receipt contract, task-level launcher, exact case context, explicit facility choice, direct-link recovery, local and mocked-browser evidence |
| Excluded     | Schema/API changes, hosted configuration, extension source changes, task/touch/status writes, deployment, release, merge                               |

## Wire and result contract

The sender uses the public environment value `VITE_MINTED_EXTENSION_ID`. It must be a Chrome
extension ID: exactly 32 lowercase characters in `a` through `p`. There is no fallback ID.

```ts
interface SetActiveCaseMessage {
  type: "SET_ACTIVE_CASE";
  caseId: string; // UUID
  providerId: string; // UUID
  orgId: string; // UUID
  portalUrl: string; // HTTPS
  portalKey?: string;
  facilityId?: string; // UUID
}

type ExtensionHandoffResult =
  | { status: "received" }
  | {
      status: "unavailable";
      reason: "missing_configuration" | "invalid_configuration" | "messaging_unavailable";
    }
  | { status: "rejected" }
  | { status: "invalid"; reason: "invalid_context" | "malformed_response" }
  | { status: "failed" }
  | { status: "timeout" };
```

`received` means only that the extension validated and stored the message. Authentication,
authorization, case application, side-panel visibility, and portal navigation remain separate
outcomes. The receipt timeout is 2,000 ms. The sender settles once, clears its timer, and ignores
late or duplicate completion. The addressed callback form supports Chrome versions before 118 and
reads `runtime.lastError` inside the callback.

## Requirements and evidence plan

| Requirement               | P05 change/evidence                                                                                                                                                                                                     | Status boundary                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| H1 intended extension     | Validate the environment ID and call `chrome.runtime.sendMessage(extensionId, message, callback)`; test exact arguments and unavailable states.                                                                         | Local/unit                            |
| H2 truthful receipt       | Typed async result; test `{ok:true}`, `{ok:false}`, malformed/undefined reply, synchronous throw, callback `runtime.lastError`, timeout, duplicate callback, and late reply.                                            | Local/unit                            |
| H3 gesture and recovery   | Start the send and request exactly one isolated portal tab before awaiting; expose independent portal and receipt status plus a direct link and extension case-search recovery. Test call order and racing persistence. | Local/unit + mocked browser           |
| H4 complete context       | Validate and snapshot UUIDs, credential-free HTTPS URL, optional normalized portal key and UUID facility; omit absent optional fields. Test exact shape and explicit secondary facility.                                | Local/unit                            |
| H5 mounted workflow       | Mount only on the active, unlocked `online_form` step in the existing case drawer. Resolve each registry target and re-derive an open drawer's lock from current filtered tasks. Block unsafe URLs and guessed context. | Component/source + focused Playwright |
| H6 receipt vs application | UI calls success “received” and states that sign-in/access are checked in the extension; no web token or application claim. Extension acceptance remains P06 evidence.                                                  | Local/unit; P06 owns receiver proof   |
| H7 recovery fidelity      | Preserve the selected case location, including an exact joined legacy selection and secondary; require explicit recovery for stale selections and choice for unresolved multiple locations; never substitute primary.   | Local/unit + mocked browser           |
| H8 stale completion       | Per-button launch generation keys authenticated user/session plus org/case/target context and ignores an older receipt after a newer click, account/org change, logout, or unmount.                                     | Local/unit/component                  |
| H9 same-case return       | P05 sends exact IDs and performs no write. Minimal same-environment return link is P06-owned if receiver changes are needed.                                                                                            | Static/data-flow review               |
| H10 installed journey     | Prepare deterministic mounted-browser coverage and record local evidence. Installed guarded-staging Chrome proof requires environment readiness and remains blocked until executed.                                     | Partial until installed evidence      |

## Callers and data trace

| Surface         | Reads                                                                                            | Writes                                                               |
| --------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Case route      | Existing `credential_cases` detail and existing `case_facilities` query with joined `facilities` | None                                                                 |
| Portal step     | Existing `portals` registry query through `usePortals`                                           | None                                                                 |
| Handoff utility | Public `VITE_MINTED_EXTENSION_ID`; browser `chrome.runtime`                                      | Extension session storage is receiver-owned; no panel database write |
| Portal launch   | Selected registry HTTPS URL                                                                      | Browser navigation only                                              |

No provider profile, access token, password, SSN, task mutation, touch, or case status crosses the
message boundary.

## Proposed files

| File                                                      | Purpose                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `.env.example`                                            | Document the public extension ID setting and format                                                      |
| `src/lib/extensionHandoff.ts` / `.test.ts`                | Validated wire construction and addressed async receipt contract                                         |
| `src/lib/portalLaunch.ts` / `.test.ts`                    | Synchronous send/open ordering and stale-completion generation guard                                     |
| `src/lib/casePortals.ts` / `.test.ts`                     | Facility resolution and narrow step eligibility                                                          |
| `src/lib/caseDetailView.ts` / `.test.ts`                  | Re-derive the open drawer task and sequential lock from current filtered tasks                           |
| `src/testFixtures/extensionHandoff.ts`                    | Sanitized cross-repo message, receipt, ID, and URL fixtures                                              |
| `src/components/cases/WorkInPortalButton.tsx`             | Gesture-safe launch, independent statuses, stale-result guard, recovery link                             |
| `src/components/portals/PortalStepLink.tsx` / `.test.tsx` | Registry/facility resolution and contextless compatibility                                               |
| `src/components/cases/StepDetails.tsx`                    | Online-form handoff context                                                                              |
| `src/components/cases/TaskDrawer.tsx`                     | Active/unlocked eligibility and location choice                                                          |
| `src/components/cases/CaseTasksPanel.tsx`                 | Thread exact case and location state                                                                     |
| `src/routes/cases.$id.tsx`                                | Supply exact case/org/provider and existing location query state                                         |
| `playwright.config.ts`                                    | Supply deterministic mocked-browser public env values and resolve an available local Chromium executable |
| `DESIGN-DEBT.md`                                          | Register the stock Button/Select/link launch and recovery composition                                    |
| Focused tests under `src/` and `e2e/case-detail.spec.ts`  | Unit, mounted mocked-browser, lock/target/location/race coverage                                         |

## Risks and stop conditions

| Risk                           | Control                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong extension/environment    | Strict ID validation; no default                                                                                                                                                    |
| Wrong tenant/case/location     | Click-time immutable snapshot; exact route-owned IDs; explicit location selection                                                                                                   |
| Popup blocking                 | Request `window.open` once from the original click and report only that request; a nullable return is not popup proof. Invocation throws are reported, and the direct link remains. |
| False success                  | Only `{ok:true}` maps to `received`; separate navigation status                                                                                                                     |
| Stale async result             | Generation guard and unmount invalidation                                                                                                                                           |
| Missing staging runtime/schema | No workaround, migration, hosted mutation, or production substitution in P05/P06                                                                                                    |

The pre-existing contextless `Open portal` link remains visible when a task or step is locked or
completed. P05 eligibility gates only the new context-bearing `Work in portal` action; changing the
ordinary link's lock semantics is outside this slice.
