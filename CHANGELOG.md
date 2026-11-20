# Changelog

## Unreleased

- The prompt now says when to draw: when the user asks, or when a plan spans several components or too many changes to picture in text. Simple questions and small changes get no diagram. The line written for a single user ("thinks in diagrams") is gone.
- The tab follows the diagram file through DSH's change feed (`useResource` on a `dsh-resource://file/…` address, backed by `workspaceFiles.changes`) instead of polling every 2 s. Updates show in about 0.2 s, and nothing is requested while the file is unchanged. A DSH without `useResource` still falls back to polling.
- Links to a diagram file open the Diagram tab. The tab type claims `.diagram/*.c4` addresses, so a link in a reply (or a delivery card) opens the interactive diagram, or brings the open tab forward, instead of a text preview. The prompt and the `[diagram]` note give the agent the link to put in its message.
- SVG previews are now off by default (`previews: false`): the link replaces the embedded image. Set `previews: true` to get them back; the prompt and the note then ask the agent to embed them again.
- The tab speaks Chinese as well as English and French, and SVG previews accept `lang: zh`. Other interface languages fall back to English. Counts ("3 links", "2 in progress") are now translated as whole phrases, so Chinese gets its measure words (3 条连线, 2 个进行中), and pills size wide characters correctly.
- Titles and descriptions in Chinese or Japanese wrap: lines break between characters (not only at spaces), closing punctuation stays at the end of a line, and wide characters are measured as such.

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
