---
name: chrome-extension-minted
description: 'Chrome Extension MV3 patterns for Minted Extension: content script → service worker messaging, form monitoring, touch logging, secure storage. Use for extension, content script, service worker, MV3, form monitor, or touch log work.'
---

# Chrome Extension MV3 for Minted Extension

Architecture patterns and recipes for maintaining the form-sensor extension in Manifest V3.

_Code shapes below are patterns, not a transcript of the current tree — confirm names against `sonny303/minted-extension` before editing._

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ PROVIDER PORTAL (provider.com)                          │
│   ↓ Observes form changes                               │
│   └─ Content Script (sonny303/minted-extension)         │
│        ↓ MutationObserver detects <input> changes       │
│        ↓ Builds touchlog entry                          │
│        ├─ chrome.runtime.sendMessage()                  │
│        └─→ Service Worker (background.js)               │
│              ├─ Stores in chrome.storage.local          │
│              ├─ Sends to Minted Panel workbench         │
│              └─→ window.postMessage() to the workbench  │
└─────────────────────────────────────────────────────────┘
```

## Core Concepts

### 1. Content Script: The Eyes

Runs in the context of the provider portal page. Can access the DOM but runs in an isolated world.

**Key responsibility:** Detect form changes, build touchlog entries, report to service worker.

### 2. Service Worker: The Brain

Runs in the background, persists across tab closures. Cannot access the page DOM directly.

**Key responsibility:** Receive touchlog entries, store them, batch-send to Minted Panel workbench, sync with cloud.

### 3. Workbench Communication

The service worker sends touchlog to the Minted Panel workbench via postMessage (cross-origin).

## Manifest V3 Essentials

**File: manifest.json**

Key changes from MV2:

- No `background` scripts, only service workers
- `host_permissions` for specific sites
- `content_scripts[].run_at: "document_start"` to catch early form population

## Content Script Patterns

### Pattern A: Form Change Detection

- Debounced monitoring with MutationObserver
- Batch send every 500ms of inactivity

### Pattern B: Validation State Capture

- Capture `aria-invalid`, error messages, validation classes

### Pattern C: Cross-origin Workbench Message

- Use `window.top.postMessage()` for cross-origin messaging

## Service Worker Patterns

### Pattern A: Persistent Touchlog Storage

- Accumulate entries in chrome.storage.local
- Associate with session ID and captured timestamp

### Pattern B: Batch Sync to Cloud

- Sync every 30 seconds
- Clear storage after successful sync
- Retry on failure

### Pattern C: Debug Commands

- Support DEBUG_EXTENSION_STATE to inspect current state
- Return touchlog count, session ID, active portals

## Testing Patterns

### Unit Test: Content Script Form Detection

- Mock MutationObserver
- Verify chrome.runtime.sendMessage called with correct payload

### Integration Test: Service Worker ↔ Content Script

- Verify message handling accumulates entries
- Verify storage is updated correctly

## Common Bugs and Fixes

| Bug                                       | Cause                                | Fix                                                       |
| ----------------------------------------- | ------------------------------------ | --------------------------------------------------------- |
| Extension stops capturing after 5 minutes | Service worker times out if idle     | Keep-alive: send dummy message every 2 min                |
| Touchlog entries duplicate                | Content script runs multiple times   | Deduplicate by field + timestamp in service worker        |
| Workbench never receives data             | Cross-origin message blocked         | Use `window.top.postMessage` with correct origin          |
| Storage quota exceeded                    | Touchlog grows unbounded             | Implement retention: delete entries older than 24h        |
| Extension breaks on page reload           | Content script detached              | Re-inject on `beforeunload` or use service worker tracking |

## Checklist: Before Shipping Extension Changes

- [ ] `manifest.json` permissions cover all provider portals
- [ ] Content script runs before page JS loads (`run_at: "document_start"`)
- [ ] Service worker doesn't access DOM
- [ ] All chrome.runtime.sendMessage calls handle async responses (`return true;`)
- [ ] Sync to cloud happens in batches (not per-entry)
- [ ] Extension has a debug mode (console endpoint to inspect state)
- [ ] No localStorage used (only chrome.storage.local/sync)
- [ ] Permissions in manifest.json match actual usage
