# Changelog

## Unreleased

### An Agent Skill instead of a DSH plugin

- The DeepSeek Harness plugin (host prompt section, tool-result notes, sidebar tab, `.ref` subagent pointers, HTML export button) is removed. dsh-diagram is now a locally installed Agent Skill: clone, `cd build && npm ci --legacy-peer-deps && node build.mjs`, then symlink or copy `skills/dsh-diagram/` into the agent's skills directory. There is no npm package or release tarball any more.
- The built skill is self-contained: the hand-written `SKILL.md`, the CLI bundled into `scripts/diagram.mjs`, and `assets/` (engine for Node, engine chunk for `serve`, lean engine for offline pages, viewer, 256 icon shards). Sources moved to `src/core`, `src/engine`, `src/cli` and `src/viewer`.
- `// carte v2` files are no longer read: the first line must be `// diagram v1`.
- CLI: `install-skill`, `skill` and `--version` are removed; `check`, `render` and `serve` remain, with unchanged options and exit codes. Valid verdicts read `[diagram] Diagram v<N> valid: …`.
- `serve` has a new API (`/api/source`, `/api/history`, `/api/history/<name>`, `/engine.js`, `/icons-NNN.js`), and the page data (`#dshd-data`) now holds `source`, `history`, `icons` and `iconIndex` instead of virtual file paths. Pages written by earlier versions keep working on their own but are not compatible with the new viewer.

### Earlier unreleased changes

- Development: `npm run verify` rebuilds and runs core checks plus every browser suite serially, failing on missing browser prerequisites. Playwright Core is pinned with the build dependencies. Shared browser drivers, isolated named scenarios and a bounded scene-contract corpus make regression checks repeatable without temporary review scripts.

- Entering an unfolded generated group keeps the displayed box positions and link routes instead of switching to an independently arranged layout. Only its contents and linked outside context remain in view.
- Fit includes that scope's neighbours and routed labels without backing out of the group; zooming back out retains the same coordinate system.
- A linked outside group kept as an expanded frame still offers a grey Go there ↗ chip and double-click navigation. If scoping turns it into a card, its hidden-state, provenance and link summaries match an engine-generated card.
- Newly visible parent context fades back in on wheel and scripted exits; unchanged links no longer blink while entering an unfolded generated scope. Pointer interruption releases a flight's opening view smoothly, without leaving invisible layers intercepting clicks; wheel input takes over its current opening progress instead.

## 0.2.0 — 2026-11-22

### HTML export

- Exported and rendered HTML pages are half the size (the reference example: 4.1 MB → 1.9 MB). The viewer and the LikeC4/Graphviz engine are stored gzip + base64 and inflated by the browser itself, still without any network request. The diagram sources stay readable as plain JSON in the file. Opening a page needs `DecompressionStream` (Chrome 80, Firefox 113, Safari 16.4 or later).
- The engine embedded in those pages no longer carries the 440 KB product-name index for icons: the page holds only the entries its diagrams use (about 2 KB for the reference example), which resolve exactly the same icons.
- The DSH export downloads half as much too: its lazy asset chunk is packed the same way and uses the same lean engine (4.1 MB → 1.8 MB).
- A box titled like a JavaScript built-in (`Constructor`, `toString`) no longer gets a broken icon.

### Interaction and camera

- A single click opens the details of a box, frame or link at once: the 250 ms wait for a possible double-click is gone.
- The `⊕ N` footer of a collapsed group is a clickable chip that unfolds it in place; `↗ N` on a grey neighbour flies to its view.
- A double-click toggles a group in place: a collapsed group unfolds (a group that cannot unfold here zooms into its view, a grey neighbour flies to its own), the empty space of an unfolded group folds it back. Any other empty space fits; a double-click no longer goes up. Entering a group's view is the wheel, **Zoom in** or Shift+Enter.
- Zooming into an unfolded group is continuous: its boxes glide from their place in the parent to their place in the group's view, and the neighbours drawn in both views glide with the zoom instead of fading out and back in. Around a collapsed group the surroundings dissolve from their old place to their new one instead of blinking out first.
- Zooming near the edge of a group that drifts towards the centre as it opens no longer makes it close and reopen at every notch.
- Escape only closes things and never moves the camera (help; the explorer from inside it; on the canvas the trace, then details, then a docked explorer); Backspace goes up a level; Shift+Enter zooms into the focused group.
- **Fit** (and `f`, and landing in a view) shows the whole current view, frame and neighbours, without leaving it; a wheel notch either way right after a fit stays in the view. A fitted view refits when a panel opens or the sidebar is resized, and opening then closing a panel restores the same picture.
- Revealing an element frames it at its view's fit instead of a close-up, with a single pulsing halo.
- The details panel pans the camera so the selected box stays visible beside it; below 600 px it becomes a bottom sheet.
- Flows are laid out left to right on wide canvases and top to bottom on narrow ones; the direction button overrides this for flows and is remembered separately.
- Search and Outline are one **Explorer** panel: a search field above the outline tree, up to 50 results with a count of the others. It is docked beside the canvas on tabs wider than 900 px (and stays open while you browse), and covers the canvas below that.
- Group footer state chips are ordered by severity (vocabulary order) rather than frequency, so blocked, deviation and waiting are never hidden behind `…`. “Zoom in” lost its `▸` (kept for disclosures).

### Visual grammar

- One meaning per symbol: the deviation state is now `≠` (Δ is kept for observed changes), the observed "moved" badge is `↷`, unfold/fold use `⊕`/`⊖` in chips, detail buttons and help, and the outline marks external elements with `◎` (`↗` only means "lives elsewhere").
- Collapsed group footers read `⊕ 30 ≠1 ↻3 ◷2 …` at one fixed size: up to three coloured state chips by severity, then `?n` for assumed descendants. No more shrinking text or `+12` totals.
- State and mark pills never cover a box's icon or kind label; on cylinders the pill sits on the lid beside the icon.
- Merged links of different kinds are dash-dotted, in the canvas and the legend, instead of looking like calls.
- The legend explains collapsed groups (`⊕ opens here`, `↗ elsewhere`) when the view has some.
- Search results colour their state pills like the outline and details.
- In details, navigation actions stay on one row and tracing is a labelled **Trace:** segmented control on its own row.
- Wording: French uses tu everywhere; “Reveal” is “Localiser” and “Zoom in” is “Zoomer dedans” in French.

### Toolbar and chrome

- The toolbar no longer overlaps or stacks on narrow sidebars: schema tabs stay on one horizontally scrollable row, and the tools group moves as a whole to a second row. Below 560 px (or when labels would not fit) tools show icons only, with full names in tooltips and accessible names.
- Schemas are tabs with an underlined current tab (`aria-current`); panel toggles use a subtle pressed style; plain actions are ordinary buttons. The inverted "pressed" pill is gone.
- Flows sit after a separator with a `▶` prefix. In a flow the breadcrumb row shows its title and **× Leave flow**, which returns to the view shown before.
- **Fold all** is always shown (disabled when nothing is unfolded) and “Laying out…” is drawn over the canvas corner, so the toolbar never shifts.
- The permanent hint line under the breadcrumb is replaced by a `?` help popover listing mouse gestures and keyboard shortcuts.
- The timeline and **Δ Changes** form one **Versions** group; Changes is hidden until a second version exists.
- `HTML` is now **Export** with a download icon; the direction button names the current layout and what a click does.
- One close button style everywhere (details, search, outline, help, notices, export errors); the search field no longer shows a second, native clear button.
- The legend can be folded; it starts open from 600 px and remembers your choice.
- Opening a panel or resizing the sidebar keeps the camera's centre point: a fitted view is refitted, a zoomed one keeps its scale.

### Reliability and configuration

- Optional `#assumed` marks distinguish inference from observation without introducing a new state or colour. Nodes show the word and collapsed descendant counts; links keep their existing type/style, with a question suffix and italic label. Optional `metadata.source` provenance appears on node and original-link details. Unlabeled-link guidance now encourages known business labels without asking agents to invent unknown details or label knowingly assumed links.

- Accepted edits now report semantic element/link changes against the previous accepted version in both DSH and the CLI. Unique moves retain relation identity; removals of at least five elements and 25% of the model warn with recovery snapshot details without refusing intentional cleanup. Unlabeled arrows receive a deduplicated soft reminder.

- Removed the unsupported `dir` setting. Diagrams always stay in `.diagram`; profiles using another value receive one warning instead of silently showing an empty tab.
- Failed engine loads, diagram reads and computations can be retried without editing the diagram. Repeated I/O failures use bounded retry backoff and deduplicated warnings, separate from DSH compatibility warnings.
- Readability refusals point to the fully qualified element or relation's source line, including repeated short ids and alternative LikeC4 declaration forms. Generated views avoid user-defined view ids, and generated diagnostics never point beyond the source file.
- Snapshot timelines and the next snapshot number sort numerically, including beyond version 9999. Session-safe diagram and pointer paths agree between the host and browser.

### CLI and export

- Offline `render` collects icons from every embedded history snapshot without laying out each version, replacing the previous ten-snapshot icon window.
- Export failures use a dismissible, theme-aware in-page banner instead of a browser alert.
- Removed PNG export from both the DSH tab and standalone viewer, including SVG rasterization and image-only snapshot code. HTML is now the only export format.
- DSH’s Diagram toolbar now exports a self-contained, offline interactive HTML file. It includes the complete diagram in the displayed version (or the last valid live version), its source, viewer, engine and filtered icons, without history or conversation messages. Export assets are loaded only on click; the CLI and browser share the same safe HTML assembly.
- Standalone CLI in the same package: `dsh-diagram check`, `render`, `serve`, `skill` and `install-skill` (Node.js >=20, no runtime dependencies). Render produces a complete offline HTML snapshot with the same interactive viewer, embedded engine, filtered icons, history, themes and English/French/Chinese UI. Serve follows a file on loopback with a strict path allowlist; check never writes files.
- A generated Agent Skills document for pi, Codex, Claude Code and other local agents, installed in `~/.agents/skills` or a chosen directory. Its format guide, verdicts and history storage are shared with the DSH plugin; golden tests preserve both DSH prompts byte-for-byte.
- CLI, HTTP traversal, HTML escaping/icon/size and prompt tests, plus an optional offline Chromium smoke test. The DSH client remains separate and uses the host's React; the standalone client bundles one production React.

### Navigation and layout

- Zooming in with the pointer beside a group that had started opening no longer enters that group anyway: the group folds back into its box (briefly animated, instant with reduced motion) and the zoom follows the pointer. A group that comes under the pointer already large (after zooming elsewhere) now opens smoothly from its closed box instead of jumping open or straight in.

- Δ Changes compares the displayed accepted model to the previous saved version by default, or an explicit first/chosen version. Neutral addition/edit/move/removal badges and detailed disclosures stay distinct from declared states; deleted nodes are attributed to surviving ancestors, never laid out again. Baselines use parse-only modelOf, cancel stale async results, and honestly wait for synchronized history instead of inventing a first diff.

- Element selection now persists by id across camera/layout/version changes, with a dashed containing-group halo, Reveal action and honest absent-version notice. Neighbour/upstream/downstream tracing traverses the original directed graph, not aggregate edges, and lists hidden reached elements without changing layout or source.

- Full-model accent-insensitive search and a WAI-ARIA text outline can reveal any element across schemas, including from a flow. Reveal centres, selects and pulses an outside halo; both entries keep the same offline, display-only behaviour.

- Selection and keyboard focus use an outside halo, preserving semantic state borders. States carry unique monochrome-safe glyphs; impacted and deviation hues are more distinct. The canvas is keyboard accessible: arrows move spatial focus, Enter opens details, +/− and Space unfold/fold, Escape closes or goes up, and f fits, with localized live announcements and visible focus rings.

- Optional `-[async]->` message/event links and `-[data]->` data transfers use distinct line patterns, weights and arrowheads without consuming state colours. Mixed aggregated kinds remain neutral and are explained per original link. The legend now shows only the current view’s encodings, and reduced-motion progress retains each link kind’s pattern.

- Merged-link details show exact scoped endpoint paths, original states and marks, with an action to unfold their hidden endpoints. Merged states use the canonical precedence and disclose mixed states; collapsed-group details count internal hidden links and external links.

- Parallel steps in dynamic flows share their causal stage number (for example 6a and 6b), rather than implying a sequential order. The reference flow and authoring guide demonstrate `parallel { }`.

- Groups open and close with a double-click: on a collapsed group it unfolds it in place, on the empty space of an unfolded group it folds it back, and on the empty space of the group you zoomed into it flies back to the parent view. A single click now shows the details (with **Unfold**, **Fold** and **Zoom in** buttons) instead of unfolding; it waits a quarter of a second only on boxes where a double-click does something, so the panel does not flash. A double-click on empty canvas still fits the view, and no longer selects text.
- Neighbour groups drawn around a group's frame (they belong to another branch of the diagram) are grey and marked `↗` instead of teal `⊕`, so they no longer look like the groups that open in place. Double-click one, or **Go there** in its details, to fly to its view.
- No more cap on the total number of elements (it was 60), and groups nest up to 6 levels (it was 4). The 60-element cap dates from before the zoom: now the user sees one level at a time, and the rules that keep each view readable stay (7 children per group, 16 boxes per view, short labels). A whole cloud platform fits in one diagram; its subscription > resource group > network > subnet > resource tree fits in the levels. Laying out about 350 elements takes about 0.9 s, about 1 000 elements about 2 s.
- A reference diagram, `examples/reference.c4`: one invented system (82 elements) that uses every kind, state, mark, icon path and limit, so each new version of the plugin can be judged on the same picture. `examples/REFERENCE.md` says where each feature is and lists the icon mismatches it shows today; `npm test` checks that it stays complete.
- The tab follows the diagram file through DSH's change feed (`useResource` on a `dsh-resource://file/…` address, backed by `workspaceFiles.changes`) instead of polling every 2 s. Updates show in about 0.2 s, and nothing is requested while the file is unchanged. A DSH without `useResource` still falls back to polling.
- Links to a diagram file open the Diagram tab. The tab type claims `.diagram/*.c4` addresses, so a link in a reply (or a delivery card) opens the interactive diagram, or brings the open tab forward, instead of a text preview. The prompt and the `[diagram]` note give the agent the link to put in its message.
- SVG previews are gone, with the `previews` and `lang` settings: the link to the diagram file opens the interactive tab, which replaced them. A profile that still sets them loads as before; they are ignored. Previews written earlier stay on disk, so images embedded in past conversations still show.

### Icons

- Boxes show icons, automatically. The plugin picks one per element from its `technology` field, then its title: product logos (about 10 000, from LikeC4's AWS, Azure, GCP and tech sets, Lobe Icons, Simple Icons and selfh.st icons), cloud services under a group named after their vendor, a language for file names, else a generic glyph from the label's words (queue, cache, DNS…, English and French) or from the element's kind. `icon none` removes one, `icon <set>:<name>` forces one. Logos sit on a tile in the theme's background colour; one-colour logos (Kafka, GitHub, all of Simple Icons) are drawn in their brand colour, or in the text colour where it would not show on that theme. All icons ship with the plugin; the browser loads only those shown, and the offline HTML export embeds those needed. The prompt tells the agent to write usual product names in `technology`, and the `[diagram]` note lists technologies with no icon and icons taken from a title alone, once per change.
- SVG icons are sanitized at build time: event handlers, active animation and non-local references are removed, while local gradients and embedded raster images remain available offline.
- On cylinders (`data`), the kind label moved onto the lid, where it no longer overlaps the title.

### Prompt

- The prompt now says when to draw: when the user asks, or when a plan spans several components or too many changes to picture in text. Simple questions and small changes get no diagram. The line written for a single user ("thinks in diagrams") is gone.

### Internationalization

- The tab speaks Chinese as well as English and French. Other interface languages fall back to English. Counts ("3 links", "2 in progress") are now translated as whole phrases, so Chinese gets its measure words (3 条连线, 2 个进行中), and pills size wide characters correctly.
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
