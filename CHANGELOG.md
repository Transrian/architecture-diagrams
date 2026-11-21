# Changelog

## Unreleased

- No more cap on the total number of elements (it was 60), and groups nest up to 6 levels (it was 4). The 60-element cap dates from before the zoom: now the user sees one level at a time, and the rules that keep each view readable stay (7 children per group, 16 boxes per view, short labels). A whole cloud platform fits in one diagram; its subscription > resource group > network > subnet > resource tree fits in the levels. Laying out about 350 elements takes about 0.9 s, about 1 000 elements about 2 s.
- A reference diagram, `examples/reference.c4`: one invented system (82 elements) that uses every kind, state, mark, icon path and limit, so each new version of the plugin can be judged on the same picture. `examples/REFERENCE.md` says where each feature is and lists the icon mismatches it shows today; `npm test` checks that it stays complete.
- SVG previews are gone, with the `previews` and `lang` settings: the link to the diagram file opens the interactive tab, which replaced them. A profile that still sets them loads as before; they are ignored. Previews written earlier stay on disk, so images embedded in past conversations still show.
- Boxes show icons, automatically. The plugin picks one per element from its `technology` field, then its title: product logos (about 10 000, from LikeC4's AWS, Azure, GCP and tech sets, Lobe Icons, Simple Icons and selfh.st icons), cloud services under a group named after their vendor, a language for file names, else a generic glyph from the label's words (queue, cache, DNS…, English and French) or from the element's kind. `icon none` removes one, `icon <set>:<name>` forces one. Logos sit on a tile in the theme's background colour; one-colour logos (Kafka, GitHub, all of Simple Icons) are drawn in their brand colour, or in the text colour where it would not show on that theme. All icons ship with the plugin; the browser loads only those shown, and the PNG export keeps them. The prompt tells the agent to write usual product names in `technology`, and the `[diagram]` note lists technologies with no icon and icons taken from a title alone, once per change.
- On cylinders (`data`), the kind label moved onto the lid, where it no longer overlaps the title.

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
