---
name: chrome-devtools-minted
description: 'Chrome DevTools patterns for Minted Panel: inspect form validation, network request logging, element state tracking, performance profiling. Use for devtools, inspect, network request, form validation, or performance debugging in Minted Panel.'
---

# Chrome DevTools for Minted Panel

Patterns and recipes for using Chrome DevTools to debug Minted Panel workbench and form sensor workflows.

_File paths, globals and endpoints below are illustrative examples of the pattern — confirm the real name against the repo before relying on one._

## Quick Reference

```
TASK                          DEVTOOLS TAB      RECIPE
─────────────────────────────────────────────────────────────────────
Form validation error         Elements → Console  Inspect <input> state, run validator in console
Network request failed        Network             Filter by fetch/xhr, check headers + response
Confidence calculation wrong  Console → Sources   Set breakpoint, step through calc logic
Form submit timing            Performance         Record session, check form change → submit latency
Extension message error       Console             Check "Show console messages" in sidebar
```

## Zone 1: Elements Inspector (Form Validation)

**Goal:** See exactly what state a form field has when validation fails.

**Steps:**

1. Open DevTools (F12)
2. Right-click the broken form field → "Inspect"
3. In Elements tab, find the `<input>` or `<select>`
4. Check attributes: `data-validation-state`, `aria-invalid`, `value`
5. Open Console tab (same panel, lower half)
6. Paste the validator for that field type
7. Read the result. If it fails, you found the gap.

**Common Minted Panel fields:**

- `input[name="npi"]` → runs `validator.checkNPI()`
- `select[name="payer"]` → runs `validator.checkPayerAllowed()`
- `input[data-type="facility"]` → runs `validator.checkFacilityMatch()`

**Output:** Screenshot or text of the validation state + console result.

## Zone 2: Network Tab (Request Logging)

**Goal:** See exactly what data the workbench sends when a form submits.

**Steps:**

1. Open Network tab in DevTools
2. Filter: Type `xhr` in the filter box
3. Perform the action (e.g., click Submit on a case)
4. Click the request in the list
5. Open "Request" tab → see the payload JSON
6. Open "Response" tab → see the server's answer

**Minted Panel endpoints to watch:**

- `POST /api/cases/{id}/submit` → case submission
- `GET /api/payers/{id}/template` → payer schema fetch
- `POST /api/touchlog` → form sensor event log
- `PUT /api/fill-sessions/{id}` → save form state

**Red flags:**

- Missing required fields in the payload → fix on client before send
- 400 response with "field X missing" → schema mismatch
- 409 response → concurrent update
- 500 response → backend bug

**Output:** Request + response bodies, any error messages.

## Zone 3: Console (Real-time Queries)

**Goal:** Inspect Minted Panel state without reloading.

**Common queries in Minted Panel:**

```javascript
// Check the current case object in memory
window.__minted?.currentCase;

// See all fill sessions for this case
window.__minted?.fillSessions.filter((s) => s.case_id === "xyz123");

// Test a validator directly
import { validator } from "./src/lib/validators.ts";
validator.checkNPI("1234567890");

// See the last touchlog entry
window.__minted?.touchlog.at(-1);

// Check extension message queue
window.__formSensor?.messageQueue;
```

**Output:** Console.log of the state or result.

## Zone 4: Sources Tab (Breakpoint Debugging)

**Goal:** Step through code and see exactly where it breaks.

**Steps:**

1. Open Sources tab
2. Press Ctrl+O (or Cmd+O), search for the file
3. Click the line number where you want to stop
4. Perform the action
5. Execution pauses at your breakpoint
6. Use the right panel to "Step Over" (F10), "Step Into" (F11), or "Step Out" (Shift+F11)
7. Watch variables in the "Scope" section on the right

**Common breakpoint locations in Minted Panel:**

- `src/lib/credentialing-engine.ts` line 42 → confidence calculation
- `src/api/form-submit.ts` line 15 → case submission handler
- `src/components/workbench/Case.tsx` line 88 → re-render trigger

**Output:** Screenshot showing breakpoint, scope variables, and the execution trace.

## Zone 5: Performance Tab (Timing Issues)

**Goal:** See if a form submission or calculation is unusually slow.

**Steps:**

1. Open Performance tab
2. Click the record button (circle)
3. Perform the slow action
4. Click stop (square)
5. Look at the timeline. Long bars = slow work
6. Zoom into the area where time was spent
7. Check which function or network request took longest

**Common slowdowns in Minted Panel:**

- Form validation running on every keystroke → debounce
- Payer schema fetch not cached → add cache header
- Large touchlog array causing re-renders → pagination

**Output:** Timeline screenshot, noted slowdown, and millisecond duration.

## Checklist: Before Shipping a Feature

- [ ] Elements inspector: all form fields have correct validation state
- [ ] Network tab: all POST requests have required fields, no 400 errors
- [ ] Console: no red errors, state is as expected
- [ ] Sources: no unintended breakpoints left in code
- [ ] Performance: no unusual slowdowns (>500ms for a single action)
- [ ] Extension: if form-sensor involved, verify extension messages are received
