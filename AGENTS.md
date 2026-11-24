# AGENTS.md

Guide for agents (and humans) changing dsh-diagram. User-facing docs live in [README.md](README.md); this file covers what you need to change the code safely.

**Local overlay.** If `AGENTS.local.md` exists next to this file, read it too. It holds notes for one machine: local paths, how the skill is linked, local test tooling. Its rules take precedence over this file for anything about that machine. The file is git-ignored: never commit it, and never copy its contents (hosts, paths, names) into tracked files.

## What this is

A locally installed Agent Skill. The build turns `src/` into a self-contained skill directory that users symlink or copy into their agent's skills directory:

| Part | Source | Built into | Runs in |
|---|---|---|---|
| Skill document | `skills/dsh-diagram/SKILL.md` (hand-written, committed) | — | the agent's context |
| CLI and MCP server | `src/cli/main.mjs` | `skills/dsh-diagram/scripts/diagram.mjs` (with the MCP SDK bundled) | Node 20+ |
| Engine | `src/engine/entry.mjs` | `assets/engine.mjs` (CLI), `assets/engine.js` (chunk served by `serve`), `assets/engine-offline.js` (same chunk without the icon index, embedded in offline HTML); built with the stubs in `build/stubs/` in place of unused LikeC4 dependencies | both |
| Viewer | `src/viewer/main.js` | `assets/viewer.js` (IIFE with production React) | the browser, on `file://` or `serve`'s localhost |
| Icon pack | `build/icons.mjs` + `src/core/iconrules.js` | `assets/icons-NNN.js` (256 shards) + `build/generated/icon-index.json` (bundled into the engine) | both |

Data flow: the agent writes `.diagram/<topic>.c4` and runs `node <skill>/scripts/diagram.mjs render <file>`. The CLI validates the file with the engine, prints a `[diagram]` verdict, snapshots accepted versions into `<file without .c4>/NNNN-<date>.c4`, and writes an offline HTML page embedding the source, its history, the viewer, the lean engine, the icons used and the icon-index entries those sources read. `serve` instead serves a remote-mode page plus a small JSON API (`/api/source`, `/api/history`, `/api/history/<name>`) and the engine/icon chunks. `mcp` runs the same commands as MCP tools over stdio (`check`, `render`, `serve`, `guide`), with `SKILL.md` as the server instructions.

Chunks (engine, icon shards) register themselves with `window.__DSHD__.define(name, factory)`, installed by the page shim in `src/cli/html.mjs`. The viewer's loader (`src/viewer/main.js`) asks for `engine.js` and `icons-NNN.js` by name; page data is the `#dshd-data` JSON (`v: 1`, `mode: embedded|remote`).

## Commands

```sh
cd build && npm ci --legacy-peer-deps   # once
cd build && node build.mjs              # everything (CLI, viewer, engine, icon pack if stale)
cd build && node build.mjs client       # viewer + CLI only (needs a prior full build)
npm run check                           # validate examples/web-shop.c4 and examples/reference.c4
npm test                                # unit, CLI and HTML tests (node:test, needs a build)
npm --prefix build run typecheck         # scoped pure-module JSDoc checks, no emitted files
node skills/dsh-diagram/scripts/diagram.mjs check <file.c4>   # verdict for any diagram
```

The generated files (`skills/dsh-diagram/scripts/`, `skills/dsh-diagram/assets/`, `build/generated/`) are git-ignored. Never edit them by hand: edit `src/` and rebuild. `src/cli/assets.mjs` points at `skills/dsh-diagram/` from the source tree; `build/build.mjs` replaces it in the bundled CLI so the script finds `SKILL.md` and its assets in its own skill directory. The engine stays out of the CLI bundle: it is imported from a computed URL.

The engine bundles replace LikeC4 dependencies the engine never runs (`@likec4/config`, `@likec4/generators`, `picomatch`, `@logtape/logtape`; with them zod and json5) with the stubs in `build/stubs/` (`unused-modules` plugin in `build/build.mjs`). A stubbed function the engine should never call throws "not available in dsh-diagram": if a LikeC4 upgrade starts calling one, remove that stub instead of extending it. `test/engine-bundle.test.mjs` keeps the removed packages out and the offline engine under 2.7 MB.

## Invariants: do not break these

- **One source of rules.** The dependency-free `src/core/vocab.js` defines `RULES`, `KINDS`, `RELATION_KINDS`, `STATES`, `MARKS`, `FORMAT`, `FORMAT_VERSION` and `ROOT_LEAF_KINDS`; the engine re-exports them. They drive the lint, the viewer's state order and the numbers quoted in `SKILL.md`. When one changes, update `SKILL.md` and the README in the same commit. `test/skill.test.mjs` checks the skill's numbers and vocabulary; `test/vocab.test.mjs` checks theme, translation and README coverage.
- **Format header.** Line 1 of every diagram is `// diagram v1` (`FORMAT`, `FORMAT_VERSION`, `formatOf`). Anything else is an error. A breaking format change bumps the version and goes in the CHANGELOG.
- **The diagram directory ignores itself.** `ensureIgnored` writes `.diagram/.gitignore` (`*`). Diagrams can name internal hosts, so they must never reach a project's git history.
- **The skill is part of the API.** `SKILL.md` is what the agent knows, through the skill or through the MCP instructions: `src/cli/mcp-text.mjs` keeps its title, intro, `## Files` and `## Format`, and replaces `## Command` and `## Workflow` with the tools. Renaming those headings breaks the MCP server loudly (`test/mcp.test.mjs`). Its example must stay a valid diagram (`npm test` computes it) and neutral (no real hosts, people or projects). It must not depend on anything outside its directory once built.
- **Offline means offline.** Embedded HTML must never fetch a script, icon, font, engine or data from the network. Inline JavaScript and JSON must be escaped against script termination; keep the escaping tests and the 2.5 MB reference-page budget green. The viewer and engine are embedded gzip + base64 (`src/cli/pack.mjs`, inflated by the shim in `src/cli/html.mjs` with `DecompressionStream`); `assembleHtml` refuses anything else, since raw text could close its script element. The shim runs the inflated code with a global (indirect) `eval`, never by inserting `<script>` elements: SharePoint's HTML viewer allows eval but refuses scripts added at runtime (`test/html.test.mjs` runs the shim with script insertion blocked). Offline pages embed `engine-offline.js`, which has no icon index: the page carries `iconIndexFor(sources)` (the entries its own sources read, which resolve the same icons) and the viewer's loader hands it to `setIconIndex` before any parse.
- **Serve only an allowlist.** Bind to loopback by default and warn on a wider bind; reject non-loopback `Host` headers on a loopback bind (DNS rebinding). Map only `/`, the built chunks, the current source and snapshot names matching `^[\w.-]+\.c4$` that are regular files; never resolve an arbitrary request path on disk. `check` writes nothing; only `.diagram/` may get an automatic `.gitignore`.
- **stdout belongs to MCP.** In `mcp` mode the protocol owns stdout: verdicts of live servers go to stderr, and `runMcp` reroutes `console.log`. The other commands never load the MCP SDK (`main.mjs` imports `mcp.mjs` lazily).
- **Parser reuse does not share document state.** `load` leases one workspace per active computation and retains at most one idle workspace. Remove old documents through the builder before rebuilding replacements; periodically clear LikeC4's layout cache. Layouts are JSON-detached before decoration and sorted by id because LikeC4 returns cache hits first. Keep the workspace-isolation/churn tests green.
- **Unfolding is display-only.** Unfolding a group in the viewer never writes the file. Unfolded views may exceed `RULES.viewNodes`; only the file itself is linted.
- **Icons are deterministic and local.** `src/engine/iconmatch.js` maps a label to an icon from the generated index alone: no network, no randomness, the same result in Node and in the browser. Index reads are own-property lookups (a title such as `Constructor` must not reach `Object.prototype`), which is also what keeps `iconIndexFor` exact. The engine only emits ids that exist in the pack (LikeC4 rejects an unknown `icon` reference). Add product names in `src/core/iconrules.js`; `build/icons.mjs` logs any rule whose target is missing from the pack.
- **No private content.** Examples, tests, screenshots and `SKILL.md` use invented systems only (see `examples/web-shop.c4`).

## Testing

- Judge rendering changes on [`examples/reference.c4`](examples/reference.c4): it uses every feature, and comparing the same diagram before and after shows what changed. [`examples/REFERENCE.md`](examples/REFERENCE.md) says where each feature is. `npm run standalone` renders it without creating history.
- Before accepting UI changes, run the complete local gate documented in [README.md](README.md#development): `DSHD_CHROMIUM=/path/to/chrome npm run verify`. It rebuilds and runs every core/browser file with bounded, longest-first scheduling; missing prerequisites, failures and skipped tests must fail, never silently downgrade to core-only validation. Standalone contexts and CLI workspaces are isolated. Animation-sensitive tests use manually advanced clocks (all frames run), alongside a real-time wheel regression. `npm run verify:fast` explicitly excludes the browser. Playwright Core is pinned with the build dependencies; do not add Chromium to CI.
- Check UI changes in light and dark themes, in French and English, and with `prefers-reduced-motion`. Check `file://` with all non-file requests blocked, including unfolding (engine recomputation), history and themes/locales. `test/browser/serve.mjs` covers the live page (updates, invalid edits keeping the last valid drawing, timeline, comparisons, deleted file). Use only invented reference/example systems for screenshots.
- Shared browser drivers belong in `test/support/browser.mjs`; isolate scenario state with fresh contexts. Scene invariants live in `test/support/scene.mjs` and are exercised by the bounded `test/scene-contract.test.mjs` corpus. New regressions need failing-before/passing-after assertions, not only diagnostic scripts or screenshots.
- Releases: add a section to `CHANGELOG.md`; there is no package or tarball. `.github/workflows/ci.yml` builds and runs the core tests on every push and pull request.

## Maintenance budgets

Keep source files around 300 lines or fewer and top-level functions around 80 lines or fewer;
prefer roughly 250/60 when choosing a new module boundary. `test/source-budget.test.mjs` enforces
300 lines/file and 80 lines/function in the core tier, including comments and nested callbacks in
the enclosing function's span. Its sole file exception is `viewer/copy.js`: parallel locale string
dictionaries, not executable logic. Do not add exceptions for ordinary code.

Keep executable source lines at most 140 characters; literal data tables may retain longer rows.
Central engine/viewer shapes live in `core/types.js`. Pure modules use `// @ts-check` and JSDoc;
`build/tsconfig.json` lists the cleanly checked scope. Run `npm --prefix build run typecheck` after
changing those shapes or modules. React/LikeC4 integration modules are deliberately outside that
scope: use their core and browser contracts, not type-error suppression.

## Layout of `src/`

Paths below are relative to `src/`; grouped rows name closely related, separate files.

| Path | Role |
|---|---|
| `core/types.js` | JSDoc shapes: model, element, relation, view, tree, entry, camera, size, trace and changes |
| `core/vocab.js` | Dependency-free kinds, states, marks, format constants and readability rules |
| `core/shared.js` | Shared pure summaries, text wrapping, edge paths and snapshot ordering |
| `core/diff.js` | Semantic model diff shared by CLI verdicts and viewer comparisons |
| `core/iconrules.js` | Icon keys, shard helpers, model/view icon collection and local rule dictionaries |
| `engine/entry.mjs` | Public engine API: compute orchestration and vocabulary/parse/lint re-exports |
| `engine/load.mjs` | Leased language workspaces, document replacement, detached layouts and diagnostics |
| `engine/parse.mjs` | Bounded parse cache, model-only queries, logger setup and offline icon-index replacement |
| `engine/model.mjs` | Serializable model summaries and icon-selection reports |
| `engine/views.mjs` | Generated scope views, unfolding, node decoration and merged-relation decoration |
| `engine/lint.mjs` | Hard lint and soft size advice sharing source-position diagnostics |
| `engine/vocabulary.mjs` | Format header parsing, specification prelude, state precedence and orientation |
| `engine/scanner.mjs` | Lexical tokens, declaration/relation positions and view orientation points |
| `engine/iconmatch.js` | Deterministic icon matching and reduced `iconIndexFor` |
| `cli/main.mjs` | Command parsing (`check`, `render`, `serve`, `mcp`) |
| `cli/render.mjs` | Validation then atomic HTML output, shared by CLI and MCP |
| `cli/mcp.mjs`, `cli/mcp-text.mjs` | Stdio MCP tools and `SKILL.md`-derived instructions/guide |
| `cli/verdict.mjs`, `cli/report.mjs` | Last-snapshot validation and pure verdict formatting |
| `cli/history.mjs` | Accepted snapshots and `.diagram/.gitignore` |
| `cli/html.mjs`, `cli/pack.mjs` | Safe page assembly, page shim, local icons and gzip/base64 packing |
| `cli/serve.mjs` | Loopback server and allowlisted API |
| `cli/assets.mjs` | Built skill/assets location, replaced by the CLI build |
| `viewer/main.js` | Chunk loading, page/server IO, theme, header, translations and mount |
| `viewer/data.js` | Live source following, history, engine and layout caching |
| `viewer/preferences.js` | Single guarded localStorage boundary; reports expected denial/quota failures |
| `viewer/body.js`, `viewer/body-state.js` | Thin body composition and hook wiring |
| `viewer/body-direction.js`, `viewer/body-chrome.js` | Schema/flow directions, sizing, compact tools, legend and help preferences |
| `viewer/body-views.js`, `viewer/body-explorer.js` | Schema/flow tree selection, return navigation and queued explorer reveals |
| `viewer/body-comparison.js`, `viewer/body-trace.js` | Comparison loading/projection and trace state/status |
| `viewer/body-content.js`, `viewer/body-panels.js` | Stage/status content, breadcrumbs, notices, workspace and legend |
| `viewer/body-toolbar.js`, `viewer/body-tabs.js` | Toolbar composition and schema/flow tabs |
| `viewer/body-versions.js`, `viewer/toolbar-tool.js` | Timeline/comparison controls and compact tool buttons |
| `viewer/help.js` | Gesture/shortcut help popover; keep aligned with shipped behaviour |
| `viewer/stage.js`, `viewer/stage-controller.js` | Thin stage DOM and hooks; ctl remains `{flyTo, fit, has, reveal, focus}` |
| `viewer/stage-camera.js` | Camera state, layout morphs, resize and redraw scheduling |
| `viewer/stage-transitions.js` | Opening, release and scope-context fade animation |
| `viewer/stage-gestures.js`, `viewer/stage-keyboard.js` | Wheel/drag gestures and virtual keyboard focus/navigation |
| `viewer/stage-selection.js`, `viewer/stage-view.js` | Selection/reveal/clearance, scene, accessibility and details composition |
| `viewer/flight-plan.js`, `viewer/flight.js` | Pure scope-operation flight plans and token-cancelled execution |
| `viewer/activation.js`, `viewer/animation.js` | Click/double-click/footer actions and shared animation scheduling |
| `viewer/render.js` | Morph geometry and recursive level drawing |
| `viewer/render-opacity.js`, `viewer/render-placement.js` | Opening fades and gliding/reshaping geometry |
| `viewer/node-view.js`, `viewer/group-view.js` | Leaf/card rendering and open group frames |
| `viewer/node-marks.js`, `viewer/edge-view.js` | Box skins/halos/badges and edges/markers/relation samples |
| `viewer/boxlayout.js` | Pure non-overlapping box headers and group footer layout |
| `viewer/zoom.js` | Semantic-zoom opening geometry, camera transforms, fit, reveal and panel avoidance |
| `viewer/zoom-tree.js`, `viewer/zoom-scope.js` | Tree/in-place view construction and scope settling/exit |
| `viewer/zoom-path.js` | Pure smooth camera paths, coordinate conversion and easing |
| `viewer/navigation.js` | Spatial focus, accent-insensitive search and reveal/selection helpers |
| `viewer/explorer.js`, `viewer/outline.js` | Search panel and keyboard-accessible textual tree composition |
| `viewer/outline-state.js`, `viewer/outline-row.js` | Outline expansion/focus/scroll state and recursive rows |
| `viewer/details.js` | Node/link metadata, navigation, trace and comparison details |
| `viewer/relations.js`, `viewer/trace.js` | Exact endpoints/unfolding and exact-graph trace/projection |
| `viewer/comparison.js`, `viewer/changes.js` | Displayed-source baseline resolution and neutral change projection |
| `viewer/change-panel.js` | Comparison controls and removal/link disclosures |
| `viewer/copy.js` | Locale string dictionaries (`en`, `fr`, `zh`; identical keys) |
| `viewer/style.js`, `viewer/theme.js`, `viewer/icons.js` | Prefixed CSS, vocabulary-ordered colours and UI icons |
| `viewer/iconpack.js` | Local shard loading and `IconMark` rendering |

## Source-to-test owners

Run these from the repository root, after a build when the suite imports the engine/CLI.
Shared integration corpora intentionally cover several cooperating modules; feature-specific
`search`, `selection`, `aggregation` and reference suites remain additional coverage, not shims.

| Source (relative to `src/`) | Owning test | Single-test command |
|---|---|---|
| `core/vocab.js` | `test/vocab.test.mjs` | `node --test test/vocab.test.mjs` |
| `core/shared.js`, `core/iconrules.js` | `test/shared.test.mjs` | `node --test test/shared.test.mjs` |
| `core/diff.js` | `test/diff.test.mjs` | `node --test test/diff.test.mjs` |
| `engine/entry.mjs`, `engine/load.mjs`, `engine/vocabulary.mjs`, `engine/lint.mjs` | `test/entry.test.mjs` | `node --test test/entry.test.mjs` |
| `engine/parse.mjs`, `engine/model.mjs` | `test/parse.test.mjs` | `node --test test/parse.test.mjs` |
| `engine/views.mjs` | `test/reference.test.mjs` | `node --test test/reference.test.mjs` |
| `engine/scanner.mjs` | `test/scanner.test.mjs` | `node --test test/scanner.test.mjs` |
| `engine/iconmatch.js` | `test/iconmatch.test.mjs` | `node --test test/iconmatch.test.mjs` |
| `cli/main.mjs`, `cli/render.mjs`, `cli/verdict.mjs` | `test/cli.test.mjs` | `node --test test/cli.test.mjs` |
| `cli/report.mjs`, `cli/history.mjs` | `test/report.test.mjs` | `node --test test/report.test.mjs` |
| `cli/html.mjs`, `cli/pack.mjs` | `test/html.test.mjs` | `node --test test/html.test.mjs` |
| `cli/mcp.mjs`, `cli/mcp-text.mjs` | `test/mcp.test.mjs` | `node --test test/mcp.test.mjs` |
| `viewer/preferences.js` | `test/preferences.test.mjs` | `node --test test/preferences.test.mjs` |
| `viewer/flight-plan.js` | `test/flight-plan.test.mjs` | `node --test test/flight-plan.test.mjs` |
| `viewer/animation.js` | `test/animation.test.mjs` | `node --test test/animation.test.mjs` |
| `viewer/boxlayout.js` | `test/boxlayout.test.mjs` | `node --test test/boxlayout.test.mjs` |
| `viewer/zoom.js`, `viewer/zoom-tree.js`, `viewer/zoom-scope.js`, `viewer/zoom-path.js`, `viewer/activation.js` | `test/zoom.test.mjs` | `node --test test/zoom.test.mjs` |
| `viewer/navigation.js` | `test/navigation.test.mjs` | `node --test test/navigation.test.mjs` |
| `viewer/relations.js` | `test/aggregation.test.mjs` | `node --test test/aggregation.test.mjs` |
| `viewer/trace.js` | `test/trace.test.mjs` | `node --test test/trace.test.mjs` |
| `viewer/comparison.js` | `test/comparison.test.mjs` | `node --test test/comparison.test.mjs` |
| `viewer/changes.js` | `test/changes.test.mjs` | `node --test test/changes.test.mjs` |
| `viewer/theme.js` | `test/theme.test.mjs` | `node --test test/theme.test.mjs` |
| All `src/` files (size gate) | `test/source-budget.test.mjs` | `node --test test/source-budget.test.mjs` |

Viewer body/stage/render/outline modules, `flight.js`, and live serving are owned by the browser
integration suites (`test/browser/standalone.mjs`, `exploration.mjs`, `serve.mjs`). Run the complete
no-skip gate for changes across those seams; `DSHD_CHROMIUM=/path/to/chrome npm run test:browser`
runs only those three suites. Type-only `core/types.js` is checked by the scoped typecheck command.
