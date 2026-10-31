# Mid-Cycle Onboarding — launch video storyboard (`/brag` plan, pre-build)

> **Amended Oct 19, 2026.** The design review decided that provider-side times are never highlighted in the product. Before rendering:
> - Drop the "First touch 0.5h · Submitted 6h · Admitted 19h" line.
> - Soften any claim that depends on how fast a provider responds.
> - The invite dialog is now just "Invite", and the email comes from the practice.
>
> The build spec is the provider onboarding engineering handoff in the Obsidian vault (`20 Projects/Minted Panel/`).

**Status:** storyboard only. Nothing is rendered; the screens it shows do not
exist yet. Written so that running `/brag` after the gateway, tracker, and
client invite ship is a short task, not a creative exercise.
**Source:** Stage 1 and Stage 2 planning docs
([stage-1](./mid-cycle-onboarding-stage-1.md), [stage-2](./mid-cycle-onboarding-stage-2.md)).
**Audience for the video:** practice owners and office managers evaluating
Minted Panel, and existing customers being told the feature is live. Not
clinicians, not developers.

## The 9-question rubric (the skill's planning gate)

1. **What is the app?** Minted Panel gets a newly hired provider from "we
   signed her" to "credentialing has started" in hours, with the provider
   typing only what nobody else knows.
2. **The one claim that earns a reaction.** "Invited at 2:11 pm. Credentialing
   started before lunch the next day."
3. **Visual hook.** The onboarding tracker's five counters ticking
   Invited → Started → Submitted → Admitted → In credentialing, in the panel's
   deep green (`#1B4D3E`) on the muted shell, with the shield mark.
4. **What to show from the actual UI.** Four screens, in this order: the
   client's "Invite a provider" dialog (three fields), the provider's gateway
   (one button, then a six-digit code), the pre-filled form with provenance
   labels ("from Shelby Sports Rehab's roster"), the tracker row moving stage to stage.
5. **Shortest satisfying video.** 20 seconds. Six beats.
6. **Tone.** Preset `polished`; direction "quiet, institutional, trustworthy —
   a healthcare product that respects the clinician's time." No gradient
   meshes, no hype vocabulary, no "supercharge."
7. **Format.** Landscape for LinkedIn and the website; a vertical cut later
   for Shorts if wanted.
8. **Music.** Bundled calm track, low; SFX only on the counter ticks and the
   code entry. Voice off.
9. **Title.** "Hired Tuesday. Credentialing Wednesday."

## Beat-by-beat storyboard (20 s)

| # | Time | Scene | On-screen text | Motion / SFX |
| --- | --- | --- | --- | --- |
| 1 | 0.0–2.5 | Dark shell, shield mark, one line. | "You just hired a provider." | Text settles; soft low note. |
| 2 | 2.5–6.0 | Client context, Invite a provider dialog: name, email, NPI, group. Cursor fills three fields, taps Send. Timestamp chip "2:11 pm". | "Three fields. No spreadsheet. No email to us." | Fields type in; send click SFX. |
| 3 | 6.0–9.5 | Provider's phone: email from "Dana Shelby via Minted Panel for Shelby Sports Rehab." Tap Continue. Gateway shows org name, one button, then six boxes filling with a code. | "A code to her inbox is the key. The link is only the door." | Phone slides in; six soft ticks for the code. |
| 4 | 9.5–13.5 | The existing provider form, pre-filled rows marked "from Shelby Sports Rehab's roster · Aug 12", blanks highlighted. Cursor fills two blanks, taps Submit. | "She confirms what you already know. Types only what you don't." | Pre-filled rows fade in first, blanks pulse once. |
| 5 | 13.5–17.5 | Tracker: five counters. The new row slides from Invited to Started to Submitted to Admitted. Line beneath: "First touch 0.5h · Submitted 6h · Admitted 19h". | "You watch it move. So do we." | Counter tick SFX per stage; row pill changes tone. |
| 6 | 17.5–20.0 | Shield mark, title, URL. | "Hired Tuesday. Credentialing Wednesday." / mintedpanel.com | Hold; music resolves. Frame picked as poster. |

Scene durations sum to 20.0 s.

## What must exist before rendering

- The `/join/$org` gateway route (identify, code, form screens).
- The "Invite a provider" dialog mounted in the client context.
- The `/providers` Onboarding grouping and the Onboarding Pipeline report.
- Seed data in a demo org (the seed universe's synthetic identities only; no
  real provider or client names).

## Share copy (draft)

One line for LinkedIn: "New hire on Tuesday, credentialing started Wednesday.
Minted Panel now onboards providers in hours, and the provider only types what
nobody else knows."

## Guardrails for the run

- Use only synthetic names from `docs/redesign/seed-universe.md` in every
  frame.
- No SSN, DEA, DOB, or home-address field is ever visible on screen, filled or
  blank.
- No third-party usernames, handles, or credits in the video or share copy.
  The skill's own template line "Built with [stack]" is omitted.
- Output goes to `brag-output-<timestamp>/`, which is git-ignored, not
  committed.
