# Changelog

## 0.1.0 — 2026-11-20

First public release.

- Live architecture diagram per conversation: the agent writes a LikeC4 model to `<workspace>/.diagram/<session>.c4`, the **Diagram** tab in the right sidebar draws it.
- Semantic zoom across nested groups, unfold in place, animated flights between levels, merged links.
- A timeline of accepted versions, plus SVG previews the agent can embed in its replies.
- PNG export of the current view (cropped, titled, with a legend of the states shown).
- Readability rules: the plugin refuses diagrams that are too heavy, with a fix list for the agent.
- `.diagram/` writes its own `.gitignore`, so diagrams never reach a project's git history.
- The tab follows the DSH interface language (English and French included).
- Requires DSH `>=0.2.2-rc.1 <0.3.0`.
