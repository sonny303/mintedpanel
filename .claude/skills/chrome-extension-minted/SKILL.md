---
name: chrome-extension-minted
description: Chrome Extension MV3 architecture and patterns for the minted-extension workbench — content script/background/side-panel messaging, the panel-API write boundary, and common MV3 bugs. Invoke for extension debugging or feature work touching src/background, src/content, or src/sidepanel.
---

# Chrome Extension MV3 — Minted Panel Workbench

Architecture notes for `sonny303/minted-extension`. Full contracts live in that repo's CLAUDE.md — read it first for anything touching a locked wire contract; this skill is recipes and common bugs, not the source of truth.

## Architecture

```
Side Panel (src/sidepanel/main.ts, vanilla TS, UI only)
    ↕ chrome.runtime messaging (src/shared/messages.ts)
Background Service Worker (src/background/, owns EVERY API call + the session)
    → fetch https://mintedpanel.vercel.app/api/*  (Authorization: Bearer <jwt>)
Content Script (src/content/, IIFE build, runs on the portal page)
    ↕ chrome.runtime messaging (worker refuses messages from tabs it didn't send to)
```

There is no direct content-script-to-panel-API path and no `window.postMessage` to the web app — the ONLY cross-boundary channel besides the API is the `SET_ACTIVE_CASE` handoff from the mintedpanel web app via `externally_connectable`, which carries identifiers and a URL only, never a profile or token value.

## Core concepts

1. **Content script** — runs in an isolated world on the portal page. Detects/fills form fields (`src/content/fillEngine.ts`, `src/content/elementPicker.ts`), reports results to the worker. Never holds a token, never calls the panel API directly.
2. **Background service worker** — the brain. Owns auth (`src/background/auth.ts`, session in `chrome.storage.session` — dies with the browser), the panel-mode state machine (`src/background/mode.ts`), the active-case handoff (`src/background/activeCase.ts`), and every fetch to the panel API (`src/background/api.ts`). Cannot touch the page DOM directly.
3. **Side panel** — UI only. Talks to the worker over `chrome.runtime` messaging, never holds tokens, never calls Supabase or the panel API itself.

An eslint rule enforces the boundary: only `src/background/` may import `@supabase/supabase-js` (Supabase is used only to mint a JWT; all data flows through the panel API). Keep the no-tokens-in-messages rule intact too.

## Manifest V3 essentials

- No persistent background page — only a service worker that can be killed and restarted at any time. Never assume in-memory state survives; anything that must persist goes in `chrome.storage.session` (per-browser-session) or is re-derived on demand.
- `host_permissions` are static in the manifest for the one shipped portal; everything else is requested at runtime via `optional_host_permissions` + `chrome.permissions.request`, scoped to the specific origins the portal registry names — never a blanket `https://*/*` request.
- Content scripts are injected on demand (`src/background/inject.ts`) when there's no static manifest match for a newly-registered portal.

## Common patterns

- **Debounced scanning** — form scans run on visibility/mutation, not on every keystroke; batch before reporting to the worker.
- **Idempotent writes** — both the fill-event log and the touch log use a client-generated id as both idempotency key and row PK, so a retry after a dropped response never double-logs.
- **MV3 worker restarts** — `getSession()` refreshes on demand rather than caching indefinitely; the API layer retries a 401 once after a forced refresh rather than surfacing it.

## Common bugs and fixes

| Bug | Likely cause | Fix |
|---|---|---|
| Fill stops working after the panel has been idle | Service worker was killed and state assumed to persist in memory | Re-derive state from `chrome.storage.session` on the next message instead of relying on a module-level variable |
| A fill or touch gets logged twice | Retry logic minting a new id instead of reusing the original | Reuse the same client-generated id across retries (idempotency key) |
| Handoff from the web app never arrives | Extension id not in the web app's CORS/`externally_connectable` allowlist, or the app origin isn't in the extension's manifest | Check both sides — `API_CORS_ORIGINS` on the panel's Vercel project and the manifest's `externally_connectable.matches` |
| A trained field map never fills | It's `proposed`, not `approved` — only approved maps fill, by design | Approve it in the panel's field-trainer flow; don't special-case proposed rows in the extension |
| Extension breaks on SPA-style navigation within a portal | Content script was injected once and the page replaced its DOM without a full reload | Re-run detection/`ensureContentScript` on URL change, don't assume one injection covers the whole session |

## Before shipping an extension change

- [ ] Manifest permissions cover the portals you're testing against
- [ ] Background service worker doesn't touch the DOM directly
- [ ] Every `chrome.runtime.sendMessage` handler that responds async returns `true`
- [ ] No token or PHI value written to `chrome.storage` — only identifiers, labels, and counts
- [ ] If you touched a wire contract, `src/shared/apiTypes.ts` mirrors the panel-side change in the same commit
- [ ] `npm run build && npm run typecheck && npm run lint && npm run test` all pass
