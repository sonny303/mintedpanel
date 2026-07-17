---
name: minted-panel-design
description: Use this skill to generate well-branded interfaces and assets for Minted Panel, a credentialing operations platform for physical therapy organizations — either for production or throwaway prototypes/mocks. Contains the design guidelines, color + type tokens, fonts, logo assets, reusable UI components, and full-screen UI kits for the web app and the Chrome extension side panel.
user-invocable: true
---

Read the `readme.md` file within this skill first — it holds the brand voice, content rules, and visual foundations — then explore the other files.

- **Tokens:** link `styles.css` (it imports everything in `tokens/`). Style with the CSS custom properties (`var(--color-*)`, `var(--mp-*)`, `var(--font-*)`, `var(--space-*)`, `var(--radius-*)`) rather than raw hex.
- **Components:** the reusable primitives live in `components/` as `<Name>.jsx` with a `.d.ts` contract and a `.prompt.md` usage note. Read the prompt file before using a component.
- **UI kits:** `ui_kits/minted-panel/` has full-screen recreations (Providers page + extension side panel) to copy layout and composition from.
- **Assets:** use `assets/logo-forest.png` on light surfaces and `assets/logo-white.png` on the dark forest sidebar/header.

Hard rules (do not break): light mode only; no gradients; no shadows on cards (1px `#E8E5E0` borders instead); 4px control radius / 6px tile radius; tabular figures on all numbers; Geist + Geist Mono; tight, functional spacing; no emoji. Copy is calm, sentence-case, action-first, with realistic credentialing data (never lorem).

If creating visual artifacts (slides, mocks, throwaway prototypes), copy the assets out and produce static HTML files for the user to view. If working in production code, copy assets and read the rules here to design as an expert in this brand.

If the user invokes this skill without other guidance, ask them what they want to build, ask a few clarifying questions, then act as an expert designer who outputs HTML artifacts or production code depending on the need.
