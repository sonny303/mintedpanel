# 04 — States and edge cases

Every state each surface can be in, what triggers it, and what the user sees. Build all of these — the ones missing from the current panel are the reason coordinators fall back to a spreadsheet.

Legend: **●** specified in the prototype · **○** specified here only, not drawn.

---

## 4.1 Session and identity

| State | Trigger | Panel shows |
| --- | --- | --- |
| ● Signed out | First run, or sign-out | Sign-in view: email, password, "Sign in". No org, no case. |
| ○ Signing in | Submit | Button shows a pending state; inputs disabled. |
| ○ Sign-in failed | Bad credentials | Inline error above the button, `#B91C1C` 12.5px. Do not clear the email field. |
| ● Signed in | Valid token | Account row with avatar; org switcher active. |
| ○ Token expired mid-session | 401 on any call | Non-destructive banner: signed out, work not lost, sign in to continue. **Values are already gone** (in-memory only) — say that plainly rather than implying data loss. |
| ○ No orgs | Account has none | Empty state naming the reason; no queue. |

## 4.2 Organization

| State | Trigger | Panel shows |
| --- | --- | --- |
| ● None selected | First run after sign-in | Org switcher reads "Select an organization…" `#9CA3AF`. Body: "Pick an org to load providers and cases." Nothing else loads. |
| ● Selected | Pick, or arrives via C1 | Org name in the switcher; queue loads. |
| ○ Single org | Account has exactly one | Auto-select. Do not make someone choose from a list of one. |
| ○ Org switch with a case in hand | Pick a different org | Confirm before dropping the case; releasing is not implicit. |

## 4.3 Case in hand

| State | Trigger | Panel shows |
| --- | --- | --- |
| ● None | Fresh session, or Release | Queue (2.2), context card reflecting the active tab. |
| ● In hand | Pickup, or C1 launch | Case card with status pill; tabs and offer render. |
| ● Mismatch with page | Active portal maps to a different case | Mismatch card + "Switch to that case". The offer for the current page is **suppressed** — do not offer to fill a form with the wrong case's data. |
| ● Released | Release ✕ | Returns to queue. No confirmation needed; nothing is lost. |
| ○ Case changed underneath | Status changed app-side while held | On next focus, refresh the pill quietly. If it moved to a terminal status (Approved / Denied / Not Pursuing), show a one-line notice and offer to release. |
| ○ Case no longer accessible | Permissions or deletion | Release with an explanation. Never leave a phantom case in hand. |

## 4.4 Queue

| State | Trigger | Panel shows |
| --- | --- | --- |
| ● Has cases | Normal | Ranked list; heading "Next up". |
| ● Portal-matched | Active tab is a known payer form | Heading "Cases that use this page"; matching case first with `THIS PAGE`. |
| ○ Empty | No open cases in this org | "Nothing open in this organization." Offer the org switcher, not a dead end. |
| ○ Loading | Org just selected | Three skeleton rows at row height. Do not collapse the layout. |
| ○ Load failed | Network or 5xx | Inline retry. Keep the context card — it still tells them where they are. |
| ○ Long queue | More than ~12 | Cap the visible list and add "Show all" rather than scrolling the panel indefinitely. |

## 4.5 Page context

| State | Trigger | Offer |
| --- | --- | --- |
| ● Unrecognized | Any non-portal page | No offer. Context card explains. Details and Progress still work — the values are useful anywhere. |
| ● Known + proven | URL matches a proven form | Dark fill card, `PROVEN`, confident count. |
| ○ Known + unproven | Matches, but no coverage check passed | Same card, no `PROVEN` chip, secondary button, note that the form hasn't been proven. **Do not offer a confident fill.** |
| ○ Known + drifted | Matches, but has broken mappings | Warning strip above the offer naming the count of broken fields; fill still allowed, and skips are expected. |
| ● CAQH | Matches CAQH | Attest card (2.4B). |
| ● Unknown form | Looks like a form, no registry match | Propose card (2.4C). |
| ○ Portal, wrong page | Registered portal, but not the form page | "You're on Banner PNM but not the enrollment form" + the direct link. |

## 4.6 Fill run

| State | Trigger | Panel shows |
| --- | --- | --- |
| ● Ready | Proven form, case in hand | Count + skip warning + "Fill this page". |
| ○ Running | Button pressed | Button pending; do not allow a second run. |
| ● Complete | All mapped fields filled | `"18 filled · 0 skipped"`, confirm action. |
| ● Partial | Some fields had no value | `"17 filled · 1 skipped"` **naming the field and why**. Never a bare count. |
| ○ Blocked — no mappings | Form registered, zero approved rows | Offer capture instead of fill. |
| ○ Blocked — all values missing | Provider record too sparse | Say which fields, link the provider record. Do not run and report 0 filled. |
| ○ Failed — selectors dead | Nothing matched | "This form has changed" + report drift (C5). Do not blame the user. |
| ○ Failed — navigation | Page changed mid-run | Report what was filled before the change. Partial truth beats silence. |
| ● Snapshot integrity | Any later data change | The report **must not recompute**. Only the pre-fill CTA reflects current data. |

## 4.7 Progress

| State | Trigger | Panel shows |
| --- | --- | --- |
| ● No steps done | Fresh case | 0 of N, empty bar. |
| ● Partial | Some ticked | Bar fill, done rows struck through. |
| ● This-page step | Current tab matches a step | `THIS PAGE` chip + `#FBFDFC` tint. |
| ● All done | Every step ticked | "Record submission" button appears. |
| ● Submitted | Button fired | Confirmation card naming the reference. Status pill moves to Submitted. |
| ○ No reference entered | All done, blank field | Allow it. Warn once, inline, 11.5px `#B45309`: some payers issue no reference. Do not block. |
| ○ Reference already on the case | Case has one | Pre-fill it and keep the "Latest wins" note. |
| ○ Steps changed app-side | Template edited | Refresh on focus. If a ticked step disappeared, say so rather than silently dropping progress. |
| ○ Write failed | Offline or 5xx | Keep the local ticks, show a retry, and be explicit that nothing has been recorded yet. **This is the state that destroys trust if it lies.** |

## 4.8 Details

| State | Trigger | Row shows |
| --- | --- | --- |
| ● Value present | Normal | Label · mono value · copy icon. |
| ● Copied | Click | `#F7FAF8` row, `#1B4D3E` check, **stays marked** for the session. |
| ● Absent | Field empty on the record | "Not on file" `#9CA3AF`, amber info icon, not clickable, group footnote with the fix. |
| ● Just verified | Pulled from CAQH this session | Value in `#047857`. |
| ○ Stale | `verified_at` older than the freshness window | Value in `#B45309` with a tooltip naming the date. **Needs the per-field timestamp (E6.2).** |
| ○ Clipboard blocked | Permission denied in frame | Fall back to select-on-click and say so once. Never fail silently — the coordinator will assume it copied. |
| ○ No fields selected | Picker emptied | "No fields on the card yet" + a link to the picker. |
| ○ Long value | e.g. a long address | Row wraps (`flex-wrap: wrap`, `word-break: break-word`). Never truncate a value the coordinator has to copy. |

## 4.9 Field picker

| State | Trigger | Shows |
| --- | --- | --- |
| ● Browsing | Opened | Groups collapsed except the last-used; counts per group. |
| ● Searching | Query typed | Matching groups auto-expand; empty groups hidden. |
| ● No results | No match | `Nothing matches "xyz".` |
| ● Saved | Save layout | Returns to Details with the new selection. |
| ○ Save failed | Offline or 5xx | Keep the picker open with the selection intact and show a retry. Do not drop the work. |
| ○ At 320px | Narrow panel | Search + collapse still usable; labels wrap. **Verify explicitly.** |

## 4.10 Capture

| State | Trigger | Shows |
| --- | --- | --- |
| ● Proposals with gaps | Capture on an unknown form | Matches with evidence; gaps actionable; submit disabled-styled. |
| ● All assigned | Every gap resolved | Submit enabled, count updated. |
| ● Sent | Submit | Sent card + "Approve all" + editor link. |
| ○ Nothing recognized | 0 of N matched | Say so honestly and still allow sending — an unmatched capture is still the field list, and mapping by hand from a real list beats mapping from nothing. |
| ○ Already captured | Portal already has rows | Offer "re-capture" as drift repair, not a fresh capture, and diff against what exists. |
| ○ Send failed | Offline or 5xx | Retain the proposals locally and retry. A lost capture means redoing the whole page. |
| ○ Worker restart mid-capture | MV3 lifecycle | Restore labels and counts, **never values**. Say what survived. |

## 4.11 CAQH

| State | Trigger | Shows |
| --- | --- | --- |
| ● Fill ready | On CAQH with a case | "Update CAQH — N fields", last attested date. |
| ● Filled | Fill run | Report + "Record attestation". |
| ● Attested | Confirmed | Green confirmation; `caqh_last_attested_date` set. |
| ● Gap present | CAQH holds a value we have blank | Exception strip + "Pull into our record". |
| ● Gap pulled | Pull | Confirmation naming the downstream effect ("next Banner fill is 18 of 18"). |
| ○ No gaps | Records agree | Omit the strip entirely. Do not show an empty section. |
| ○ Attestation not due | Recently attested | Note the date and de-emphasize the offer. Do not push a pointless attestation. |

## 4.12 Platform failure modes

| State | Trigger | Behavior |
| --- | --- | --- |
| ○ Worker restart | MV3 lifecycle, frequently | Restore case identity, labels, counts, tab context. **Never restore values.** Show what came back. |
| ○ Offline | Network lost | Disable writes with a clear reason. Copy still works — the values are already in memory, and that is genuinely useful offline. |
| ○ Panel dragged to 320 | User resize | Every surface remains usable; nothing clips; no horizontal scroll. |
| ○ Page zoom | Browser zoom | Layout holds — no viewport units, no fixed heights. |
| ○ Popover near the edge | Any styled overlay | Must fit inside the panel. Native `<select>` is exempt (the OS draws it). |
| ○ Two tabs, same portal | Duplicate tabs | Context follows the active tab. Do not offer two competing fills. |
