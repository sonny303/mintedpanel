---
name: chrome-devtools-minted
description: Chrome DevTools recipes for debugging Minted Panel and the minted-extension workbench — inspecting form state, reading network requests to the panel /api routes, and profiling slow renders. Invoke for DevTools-based debugging, form validation issues, network request failures, or performance complaints.
---

# Chrome DevTools for Minted Panel

Recipes for debugging the panel app (`sonny303/mintedpanel`) and the extension's side panel / content script (`sonny303/minted-extension`) with Chrome DevTools.

## Quick reference

| Symptom | Tab(s) | Approach |
|---|---|---|
| A form field won't validate or save | Elements → Console | Inspect the input's attributes/value, then check the relevant service in `src/services/*.ts` |
| A network request to `/api/*` fails | Network | Filter `fetch/xhr`, inspect request headers (`Authorization`, `x-org-id`) and the `{data,error,meta}` response envelope |
| A calculation looks wrong (readiness, generation buckets, status) | Sources | Breakpoint in the relevant `src/lib/*.ts` pure module |
| A screen feels slow | Performance | Record the interaction, look for long tasks and excess re-renders |
| Extension message never arrives | Console (background + content) | Check `chrome://extensions` → service worker console, and the content script's own console on the page |

## Elements + Console: form/field state

1. Right-click the field → Inspect.
2. Check `value`, `aria-invalid`, and any `data-*` attributes the component sets.
3. In Console, look at the Network tab for the mutation that should have fired — most writes go through a service in `src/services/` and a hook in `src/hooks/`, not inline handlers.

## Network: `/api` requests

Filter by `fetch/xhr` and inspect the specific route. Every response is the envelope `{ data, error, meta }` (`src/server/envelope.ts`); every request needs `Authorization: Bearer <jwt>`, and a multi-org caller needs `x-org-id` or gets a 400 (never a silent guess). Routes worth knowing:

- `GET /api/providers/:id/profile?state=&facilityId=` — the fill payload; `meta.needs_facility` means the caller must pick a facility first.
- `POST /api/cases/:id/touches` — the business-log write; body is snake_case (locked), unlike most other bodies.
- `POST /api/fill-events` — the fill-attempt log; camelCase body.
- `PATCH /api/tasks/:id/steps` — the one task-state write.

Common causes of a non-2xx: missing `x-org-id` for a multi-org user (400), a cross-org id (404 — isolation is enforced in `guard.ts`, not RLS, on `/api` routes), or a stale JWT (401 → the client should retry once after a forced refresh).

## Console: inspecting app state

This app doesn't expose global debug objects on `window`. Instead:

- TanStack Query cache: if React Query Devtools is mounted in dev, use it to see cached rows per query key (`src/hooks/queryKeys.ts`).
- Zustand auth/org store: temporarily `console.log` inside `src/lib/auth-store.ts` to see `activeOrgId` and role — there's no console-accessible singleton by default.
- Extension side: the background service worker has its own console (`chrome://extensions` → service worker → inspect); the content script logs to the host page's console.

## Sources: breakpoint debugging

1. `Cmd/Ctrl+O`, search for the file.
2. Set a breakpoint, trigger the action, step through.

Useful breakpoint spots: `src/lib/caseStatus.ts` (status transition rules), `src/lib/enrollmentReadiness.ts` (readiness derivation), `src/server/api.ts` (route dispatch — `isApiRequest`), `src/services/generationConfirm.ts` (case-generation confirm loop).

## Performance: slow renders

Known slow spot (documented in CLAUDE.md): typing in Step 3 of the SOP template wizard re-renders every task card unless `TemplateTaskRow` stays `React.memo` with every handler passed to it as a `useCallback`. If you measure ~250ms+ per keystroke there, that regression is the first thing to check — not a new one.

General approach: record the interaction in Performance, look for long yellow (scripting) bars, and check whether a list component is re-rendering rows it doesn't need to (usually a missing memo or an unstable callback prop).

## Checklist before shipping a form or API change

- [ ] Elements: field validation state matches what the user sees
- [ ] Network: `/api` requests carry the right headers, responses are the `{data,error,meta}` envelope, no unexpected 4xx
- [ ] Console: no uncaught errors, cache/store state matches expectations
- [ ] Sources: no breakpoints left set
- [ ] Performance: no new >250ms interaction on a hot path
- [ ] If extension-related: check both the background service worker console and the content script console
