# architecture-diagrams

An [Agent Skill](https://agentskills.io) that lets a coding agent draw interactive architecture diagrams.

The agent writes a small [LikeC4](https://likec4.dev) model to `.diagram/<topic>.c4` and runs the skill's script, which validates it and renders a self-contained HTML page. The diagram answers two questions at a glance:

- **How is it built?** The architecture, as nested groups you zoom into one level at a time.
- **What will the agent touch?** The same elements, tagged `planned`, `doing`, `done`, `blocked`… as the work goes on.

![The viewer: examples/web-shop.c4 with Frontend and Checkout unfolded in place](docs/screenshot.png)

It is not a log. There are no task boxes and no history in the drawing. Reasons, numbers, commits and test results go into metadata, which you see when you click a box.

## Install

Requires **Node.js 20 or newer**. The built files are not committed: clone, build once, then link the skill directory into your agent's skills directory.

```sh
git clone https://github.com/Transrian/architecture-diagrams.git
cd architecture-diagrams/build && npm ci --legacy-peer-deps && node build.mjs && cd ..
ln -s "$PWD/skills/architecture-diagrams" ~/.claude/skills/architecture-diagrams     # Claude Code
ln -s "$PWD/skills/architecture-diagrams" ~/.agents/skills/architecture-diagrams     # Codex, pi
ln -s "$PWD/skills/architecture-diagrams" ~/.pi/agent/skills/architecture-diagrams   # pi
```

A symlink follows later rebuilds; `cp -rL skills/architecture-diagrams <skills dir>/` makes an independent copy. After the build, `skills/architecture-diagrams/` is self-contained: [`SKILL.md`](skills/architecture-diagrams/SKILL.md), the bundled CLI (`scripts/diagram.mjs`) and its assets (engine, viewer, icon pack). It needs no runtime dependency or network access.

`SKILL.md` teaches the agent when to draw, where the file goes, how to run the script and the format. Ask it, for example: “Draw the architecture diagram of this project.”

## CLI

The agent runs the script by its absolute path; you can too:

```sh
node skills/architecture-diagrams/scripts/diagram.mjs check .diagram/my-system.c4    # verdict only; writes nothing
node skills/architecture-diagrams/scripts/diagram.mjs render .diagram/my-system.c4   # snapshot + my-system.html
node skills/architecture-diagrams/scripts/diagram.mjs serve .diagram/my-system.c4    # live viewer, prints its URL
```

- Every command prints a `[diagram]` verdict: valid (with the schemas, drill-down views and flows, observed changes since the last accepted version, a warning on mass deletion, icon hints), advice when it exceeds the size targets, syntax errors with their locations, or a refusal listing labels too long or elements outside a schema.
- **`render`** writes a single, self-contained HTML page. Open its printed `file://` link, or share the file: it includes React, the complete LikeC4/Graphviz engine and only the needed icons, and makes **no network requests**. The viewer and engine are stored gzip + base64 and inflated by the browser itself (`DecompressionStream`: Chrome 80, Firefox 113, Safari 16.4 or later), and the engine carries only the icon-index entries the diagram uses, so the reference example is about **1.75 MB**, under a 2.5 MB test budget. Pages also open in SharePoint's HTML viewer. It is a snapshot: run `render` again after each edit. `-o out.html`, `--lang en|fr|zh` and `--open` control the output and browser. An invalid/refused diagram leaves the previous HTML untouched; `--force` writes a page showing the errors but still returns exit code 1.
- Accepted versions live beside the source in `<name>/NNNN-<date>.c4`. Unchanged text is deduplicated. `--no-history` skips creating a snapshot; `--history-max N` embeds the last N versions (50 by default, 0 for none). `.diagram/` gets its own `.gitignore`, even with `--no-history`; no ignore file is written for arbitrary source directories.
- **`serve`** binds to **127.0.0.1** and an automatically chosen port by default. It polls the source about once a second, prints verdicts and snapshots accepted versions; the page polls about every two seconds and keeps the last valid drawing while an edit does not parse. A readability refusal is drawn with a neutral “Refused, not kept as a version” banner; it creates no snapshot. If the server becomes unreachable after a successful load, the page keeps its drawing and camera, shows “Disconnected, retrying”, and restores the live indicator on recovery. A deleted source empties the drawing and its Explorer, legend, timeline and Changes panels; restoring the file brings them back. `--port N` and `--host ADDRESS` override the binding; exposing it beyond loopback emits a warning because diagrams can contain private hostnames. Only the page, the engine and icon chunks, the current source and the snapshots are served, never arbitrary filesystem paths. Stop with Ctrl-C.
- The theme button cycles automatic → light → dark and remembers the choice locally. The language defaults to the browser preference, falling back to English.

Exit codes: **0** success, **1** invalid or refused diagram, **2** usage/I/O error. See `--help` for all options.

## MCP server

For clients without Agent Skills, the same script runs an MCP server over stdio. After the build, register it with the absolute path of the script:

```sh
claude mcp add diagram -- node "$PWD/skills/architecture-diagrams/scripts/diagram.mjs" mcp   # Claude Code
```

```json
{ "mcpServers": { "diagram": { "command": "node", "args": ["/abs/path/architecture-diagrams/skills/architecture-diagrams/scripts/diagram.mjs", "mcp"] } } }
```

- Tools: `check`, `render` and `serve` take an absolute `file` path (and an optional `lang`) and return the same verdicts as the CLI; `render` adds the page's `file://` link, `serve` the URL of a live page. `guide` returns the file and format rules.
- The server instructions are `SKILL.md`, with the tools in place of the script: a client that reads them knows when and how to draw without the skill.
- `serve` starts one loopback server per file inside the MCP process; those servers stop when the client disconnects.

## Where the diagrams live

```
<workspace>/.diagram/
├── .gitignore                    "*": the directory ignores itself, no project config needed
├── <topic>.c4                    one diagram per subject (written by the agent)
├── <topic>.html                  its rendered page
└── <topic>/
    └── 0001-<date>.c4 …          every accepted version (the timeline)
```

Diagrams can name internal hosts or services, so they never reach git. The CLI creates `.diagram/.gitignore` itself the first time it renders a diagram there.

## Viewer features

- **Schemas.** Each top-level group is a schema and gets a tab at the top of the page; the current one is underlined. Unrelated subjects go in separate schemas. The tab row stays on one line and scrolls sideways when the window is narrow (a vertical wheel scrolls it too).
- **Compact toolbar.** The tools (versions, Explorer, Fold all, layout direction, Fit, `?` help) always occupy their own row below the horizontally scrollable tabs. Below 560 px, or when their labels would not fit on one row, they show icons only, with the full name as tooltip and accessible name. Toggles that open something (Explorer, Changes, help, legend) look pressed while open; **Fold all** is always there, disabled while nothing is unfolded, so the toolbar never shifts; “Laying out…” shows over the corner of the canvas.
- **Flows.** Dynamic views follow the schema tabs after a separator, marked `▶`. A flow shows its title in the breadcrumb row with **× Leave flow**, which returns to the view you were in. A flow is laid out left to right when the canvas is wide (more than 1.3 times as wide as it is tall) and top to bottom otherwise; the layout direction button overrides this for flows, and that choice is remembered separately from the schemas' direction.
- **Help and legend.** The `?` button opens a cheat sheet of mouse gestures and keyboard shortcuts (Escape or a click outside closes it). It fits the canvas height; a down-arrow cue marks additional scrollable shortcuts on short windows. The legend at the bottom folds into a **Legend** toggle; it starts open when the viewer is at least 600 px wide and tall, and your choice is remembered.
- **Semantic zoom.** The whole diagram is one canvas. Scroll over a collapsed group and it grows, slides to the centre and turns into its own view, while the rest fades out. Scroll back out to return to the overview. The breadcrumb and the schema tabs fly you there with an animation. **Fit** (`f`, or a double-click on empty space) shows the whole current view, its frame and the neighbours around it, without leaving it: a wheel notch either way right after a fit stays in the view. Opening a panel or resizing the window keeps the picture: a view shown at its fit keeps fitting, any other camera keeps its scale and its centre point.
- **Click, chip, double-click.** A single click on a box, a frame or a link opens its details at once. A double-click on a collapsed group, or one click on the `⊕ N` chip in its footer, **unfolds it in place**: boxes slide from the old layout to the new one. A double-click on the empty space of an unfolded group folds it back, as do its `⊖ Fold` chip, **⊖ Fold** in its details, the keyboard and **Fold all**. A double-click on any other empty space fits. To enter a group's own view, scroll over it, use **Zoom in** in its details or press Shift+Enter: an unfolded generated group keeps its box positions and link routes, showing only its contents and linked neighbours. Fit includes that context without backing out of the group. Authored views can still arrange their contents differently. To go back up, use the breadcrumb, scroll out or press Backspace. This only changes the display: nothing is written to the file.
- **Neighbours look different.** Inside a group's view, groups from elsewhere in the diagram that are linked to it are drawn around the frame in neutral grey, marked `↗`: they do not open here. Click their `↗ N` chip, double-click them, or use **Go there ↗** to fly to their own view. Groups that open in place or zoom keep the teal accent and `⊕`.
- **Icons, automatically.** Each box shows the logo of its product (Kafka, PostgreSQL, Snowflake, vLLM, Lambda…), picked from its `technology` field or its title. Cloud services resolve inside a group named after their vendor ("Functions" under Azure). With no product, a generic glyph from the words of the label stands in (queue, cache, database, DNS, firewall…, in English or French), else a glyph of the element's kind. See [Icons](#icons).
- **Keyboard and non-colour cues.** Tab into the diagram, use arrows to move spatial focus, Enter for details, Shift+Enter to zoom into the focused group, +/− or Space to unfold (⊕) / fold (⊖), Backspace to go up, f to fit and `/` for the explorer. Escape only closes things, never moves the camera: help first, the explorer when the focus is in it, and on the canvas the trace, then the details, then a docked explorer. Native toolbar/detail buttons remain keyboard accessible. Selection and focus use an outside halo without replacing state borders; every state also has a text label and unique glyph. Reduced-motion preferences are respected.
- **Groups stand out.** A collapsed group is drawn as a stack of cards in teal. Its footer, at one fixed size on every card, reads `⊕ N` (how many elements it holds; `↗ N` for a grey neighbour), then up to three state chips such as `≠1 ↻3 ◷2` in their colours, by severity (blocked, deviation and waiting before in progress, planned, impacted, done and frozen), `…` when more states exist, and `?n` for assumed descendants. Chips that do not fit are dropped from the right, so the most severe states stay visible longest; the details panel keeps the full breakdown. State and mark pills never cover a box's icon or kind label: the kind label gives way first, then the pill text is shortened. The legend explains `⊕ opens here` and `↗ elsewhere` when the view has such groups.
- **One meaning per symbol.** States: `⊘` blocked, `≠` deviation, `‖` waiting, `↻` in progress, `◷` planned, `↔` impacted, `✓` done, `❄` frozen. Observed changes: `+` added, `Δ` changed, `↷` moved, `−` removed. `⊕` / `⊖` unfold / fold in place, `↗` lives elsewhere, `?` assumed, `▶` a flow, `→` a link's direction.
- **Merged links.** Several relations between two collapsed boxes show as one edge labelled "3 links". Click it for each exact endpoint path, label, state and mark, and **Unfold endpoints** to expose hidden endpoints inside the current view. Mixed states are disclosed instead of silently taking the first relation’s state. Collapsed-group details also count internal hidden links and external links.
- **Explorer: search and outline in one panel.** **Explorer** (or `/` anywhere on the page except in an input, textarea, select or editable content) opens a search field above the complete outline tree of the displayed version. With an empty field, the tree is a text alternative to the diagram: arrows navigate or expand/collapse, Enter reveals an element (ArrowDown from the field enters the tree, ArrowUp on its first row returns). The tree follows the camera's current group, not the selected box: it opens that path, scrolls it into view and marks the group with an accent stripe and tint, without collapsing other branches or moving keyboard focus. Typing searches titles, full ids, technologies and descriptions regardless of accents or case, listing up to 50 results with their exact path and state, then how many more matched. Choosing an element leaves a flow if needed, flies to its view and frames it at the view's fit (never a close-up), then opens its details. On pages wider than 900 px the explorer is docked beside the canvas and stays open while you browse; narrower, it covers the canvas and closes when you choose. The search-field `×` clears a non-empty query and keeps focus in the field; with an empty field it closes the explorer. Escape returns to the canvas.
- **Persistent selection and tracing.** Element identity survives zoom, unfolding, layout direction, live edits and timeline navigation; a dashed outside halo marks a visible group hiding the selection, and **Reveal** returns to it. If a version lacks the element, a discreet notice says so. The details panel never hides the box it describes when there is room: the camera pans it clear. Below 600 px the panel becomes a bottom sheet across the canvas. Details offer a **Trace:** group of **Neighbours**, **Upstream** and **Downstream** toggles on its own row, computed on exact original relations (never inferred from merged edges). A trace survives navigation, lists hidden reached elements and only gently dims unrelated content. Escape clears it. Starting a trace from a group takes the union of exact traces from that group and all its descendants; the counts explicitly include these seeds. Reaching a group through a link still touches that group only, not its children: containment and merged edges never create traversal paths.
- **Timeline and observed changes.** Every accepted version is kept. Step back through earlier versions with the slider of the **versions** group in the toolbar. The newest notch reads **latest** on an embedded page and **live** when served. A refused live drawing has its own **unsaved** notch, leaving the last accepted snapshot reachable. With at least two saved versions (or one plus a refused live drawing), **Δ Changes** compares the displayed version with its **previous version** by default; a refused live drawing uses the latest accepted snapshot instead. First or chosen saved versions are optional baselines. Neutral + / Δ / ↷ / − badges mean observed additions, edits, moves and removals—not declared state or `#new`/`#removed` marks. Folded groups summarize descendants; details show bounded old and new field values, old paths and removals. Deleted elements are never redrawn: counts attach to their nearest surviving ancestor, with a global removal list for deleted schemas. No-history/first-version states are explicit, not fictitious diffs.
- **Readability rules.** The CLI refuses labels that are too long and elements left outside a schema, and the agent gets the list of what to fix. Sizes are targets only: more than 7 children per group, 6 levels, 8 top-level elements or 16 boxes per view are accepted with an advice line, so a deliberately deep or dense schema still renders. There is no limit on the total number of elements: the zoom shows one level at a time, so a whole cloud platform fits.

### File format

The first line must be `// diagram v1`. The rest is LikeC4 `model { }`, plus `views { }` for dynamic views only. The viewer generates one view per group itself.

| | |
|---|---|
| kinds | `system` (schema or group), `machine`, `service`, `component`, `data`, `doc`, `person`, `external`, `hardware` |
| relation kinds | plain `a -> b` is a call/use (caller → callee); `a -[async]-> b` is a message/event (producer → queue → consumer); `a -[data]-> b` is copied/synced data (source → destination). `= data` still declares an element. |
| states | `#planned` `#doing` `#done` `#impacted` `#deviation` `#blocked` `#waiting` `#frozen` (one per element) |
| marks | `#new` `#removed` `#assumed` (combine with a state; assumed means inferred, not observed in code, configuration or command output) |
| metadata | `why`, `decided` (`agent` / `user`), `proof`, optional `source` (file, command or document provenance); any other key is shown as is |

`#assumed` is a provenance mark on an element or relation, not a progress state: it can stand alone or combine with any state, including `#planned` and `#frozen`. Use it when a component or link was inferred rather than observed; `metadata.source` can optionally name the file, command or document supporting that interpretation. The viewer shows a neutral word badge, counts assumed descendants on collapsed groups, and adds `?` plus italics to assumed link labels—without inventing a confidence percentage or changing their line type or colour. A mark on an endpoint never implies that its links are assumed.

Relation types use shape rather than colour: calls are solid with a filled arrow, `async` links have long dashes and an open arrow, and `data` links are thicker with a double chevron. A merged edge containing different types is dash-dotted, unlike any single type, in the canvas and the legend; its details list each original type. State colours remain independent of the relation type, and the legend shows only states and types present in the current view.

See [`examples/web-shop.c4`](examples/web-shop.c4) for a small diagram, and [`examples/reference.c4`](examples/reference.c4) for one that uses every feature ([where each one is](examples/REFERENCE.md)).

### Icons

The agent does not pick icons: the engine does, the same way every time. First hit wins:

1. `icon <set>:<name>` written on the element (LikeC4 ids: `aws:`, `azure:`, `gcp:`, `tech:`, `bootstrap:`), or `icon none`.
2. The `technology` field, matched against product names ("PostgreSQL 16", "Apache Kafka", "Kafka, Avro"). Case, accents, punctuation and version numbers are ignored.
3. The title, more strictly: a product named like a common word ("Spark", "Vault") matches only a title that is just that name. A file name ("Cart.tsx", "main.py") gets its language.
4. A generic glyph from the words of the label: queue, cache, database, bucket, DNS, load balancer, firewall, scheduler… (English and French).
5. A glyph of the kind (`data`, `machine`, `hardware`, `doc`, `external`, `service`, `component`), for leaf boxes only.

Cloud service names ("Lambda", "Functions", "Storage") use the vendor's own icons when the element or one of its groups names the vendor (AWS, Azure, GCP); unambiguous ones (EKS, DynamoDB, BigQuery, S3) work anywhere. The `[diagram]` verdict tells the agent which technologies found no icon and which icons came from a title alone, so a codename that looks like a product can get `icon none`.

Everything is local: about 10 000 icons are bundled with the skill and a page carries or loads only the ones its diagram shows. They come from [LikeC4's icon sets](https://github.com/likec4/likec4/tree/main/packages/icons) (AWS, Azure, GCP, tech logos, Bootstrap Icons), [Lobe Icons](https://github.com/lobehub/lobe-icons) (AI products), [Simple Icons](https://simpleicons.org) and [selfh.st icons](https://selfh.st/icons/) (self-hosted and infrastructure software). The name rules live in [`src/core/iconrules.js`](src/core/iconrules.js); a new product name is usually one line there. Logos are trademarks of their owners.

## Development

| Path | Role |
|---|---|
| `skills/architecture-diagrams/SKILL.md` | The skill document (hand-written; its numbers and vocabulary are tested against `src/core/vocab.js`) |
| `src/core/` | Dependency-free vocabulary and rules (`vocab.js`), shared helpers, icon name rules, semantic model diff |
| `src/engine/` | Engine shared by the CLI and the viewer: prelude, one view per group (+ unfold), state roll-up, readability rules, icon resolution |
| `src/cli/` | CLI and MCP server: verdicts and reports, accepted-version history, safe HTML assembly, loopback server |
| `src/viewer/` | Viewer page: loader and page data (`main.js`, `data.js`), toolbar and panels, camera and semantic zoom, rendering, translations |
| `build/build.mjs` | Bundles `src/` into `skills/architecture-diagrams/scripts/diagram.mjs` and `skills/architecture-diagrams/assets/` (engine, viewer, icon shards) |
| `build/icons.mjs` | Icon pack: merges the icon sets into `build/generated/icon-index.json` (names → ids, in the engine) and 256 `icons-NNN.js` shards |
| `test/` | Unit, CLI, HTML and scene-contract tests (`npm test`, after a build) and browser suites (`test/browser/`) |

- `cd build && node build.mjs` builds everything; `node build.mjs client` rebuilds only the viewer and the CLI (it needs an initial full build for the engine). Run `render` again, or refresh a `serve` page, to see the change.
- `npm run check` validates both examples; `npm run standalone` renders the reference diagram to `/tmp/reference.html` without creating history.
- Complete local verification: `ARCHD_CHROMIUM=/path/to/chrome npm run verify`. It checks browser prerequisites, rebuilds, validates examples, then schedules **every core and browser file together**, longest suites first. File workers are capped at four (and at available CPUs); standalone scenarios overlap in at most six fresh browser contexts (1.5 per CPU), CLI scenarios in at most two isolated workspaces. Animation-sensitive checks advance a paused browser clock without skipping animation frames; a separate real-time wheel scenario remains. Fixture versions share one bundled CLI process over stdio MCP; they still exercise the built HTML. Each verification phase prints elapsed time. Missing tooling, failures, skips and TODOs fail the gate. Playwright Core is pinned in `build/package-lock.json`; install it with the build dependencies (`cd build && npm ci --legacy-peer-deps`). Chromium remains an explicit local prerequisite and is not installed by CI.
- The whitespace gate checks staged and unstaged changes **and every untracked, non-ignored file**, without staging anything. Unrelated drafts in the checkout can therefore fail this check too.
- `npm run verify:fast` rebuilds and checks core tests **without browser coverage**. `ARCHD_CHROMIUM=/path/to/chrome npm run test:browser` rebuilds and runs only the browser suites. `npm test` runs core tests against existing build outputs.
- Browser helpers live in `test/support/browser.mjs`; each scenario has a fresh browser context. To debug one case after building: `ARCHD_CHROMIUM=/path/to/chrome node --test --test-name-pattern='scope exit matrix' test/browser/standalone.mjs`. Screenshots go to the ignored `.local/*-check/` test directories.
- The bounded scene corpus (`test/scene-contract.test.mjs`) checks three invented models, five expansion sets, both directions and three viewport sizes. Its oracle verifies relation preservation, parent/edge references, stable geometry/routes, scoped context, Fit bounds and entry thresholds; deliberately damaged scenes must fail. It does not claim exhaustive graph coverage.
- Generated files (`skills/architecture-diagrams/scripts/`, `skills/architecture-diagrams/assets/`, `build/generated/`) are not committed. The icon pack is rebuilt only when its sets, rules or generator change.
- Contributor and agent notes (invariants, layout): [AGENTS.md](AGENTS.md). Changes per version: [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE). The bundled icons keep their own licenses, listed at the end of [LICENSE](LICENSE).
