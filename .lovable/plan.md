# Fix stale "OpenPanel" social image in Publish dialog

## What's happening

The Publish dialog's "Social image" preview is showing an old screenshot with the "OpenPanel" wordmark. That image is not coming from your live site — it's a hardcoded URL in `src/routes/__root.tsx`:

- `og:image` and `twitter:image` both point at `https://pub-…r2.dev/…lovable.app-1781492195504.png`
- That file is an auto-captured screenshot of the login page from before the rebrand, so it still shows "OpenPanel"

The rest of the metadata (title, description, og:title, twitter:title) is already "Minted Panel Credentialing" — only the pinned image is stale.

There's a second, smaller issue: per project head-meta rules, `og:image` should never live in `__root.tsx` because the root `head()` concatenates into every route and would override any per-page share image.

## Fix

Edit `src/routes/__root.tsx` only:

- Remove the `og:image` meta entry (line 93)
- Remove the `twitter:image` meta entry (line 94)

With no explicit `og:image`, Lovable hosting injects the project's current preview (a fresh screenshot of the live site) at serve time, so the Publish dialog and shared links will show the Minted Panel branding.

No other files change. No routing, styling, or backend changes.

## After deploying

Republish so the new HTML ships. The Publish dialog preview and any newly-scraped link previews will pick up the current site; previously-scraped previews on external platforms (Slack, LinkedIn, iMessage) stay cached until those platforms re-fetch — you can force a refresh from each platform's link-preview debugger.
