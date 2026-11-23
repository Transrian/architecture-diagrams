# AGENTS.md

Guide for agents (and humans) changing dsh-diagram. User-facing docs live in [README.md](README.md); this file covers what you need to change the code safely.

**Local overlay.** If `AGENTS.local.md` exists next to this file, read it too. It holds notes for one machine: local paths, how the skill is linked, local test tooling. Its rules take precedence over this file for anything about that machine. The file is git-ignored: never commit it, and never copy its contents (hosts, paths, names) into tracked files.

## What this is

A locally installed Agent Skill. The build turns `src/` into a self-contained skill directory that users symlink or copy into their agent's skills directory:

| Part | Source | Built into | Runs in |
|---|---|---|---|
| Skill document | `skills/dsh-diagram/SKILL.md` (hand-written, committed) | — | the agent's context |
| CLI | `src/cli/main.mjs` | `skills/dsh-diagram/scripts/diagram.mjs` | Node 20+ |
| Engine | `src/engine/entry.mjs` | `assets/engine.mjs` (CLI), `assets/engine.js` (chunk served by `serve`), `assets/engine-offline.js` (same chunk without the icon index, embedded in offline HTML) | both |
| Viewer | `src/viewer/main.js` | `assets/viewer.js` (IIFE with production React) | the browser, on `file://` or `serve`'s localhost |
| Icon pack | `build/icons.mjs` + `src/core/iconrules.js` | `assets/icons-NNN.js` (256 shards) + `build/generated/icon-index.json` (bundled into the engine) | both |

Data flow: the agent writes `.diagram/<topic>.c4` and runs `node <skill>/scripts/diagram.mjs render <file>`. The CLI validates the file with the engine, prints a `[diagram]` verdict, snapshots accepted versions into `<file without .c4>/NNNN-<date>.c4`, and writes an offline HTML page embedding the source, its history, the viewer, the lean engine, the icons used and the icon-index entries those sources read. `serve` instead serves a remote-mode page plus a small JSON API (`/api/source`, `/api/history`, `/api/history/<name>`) and the engine/icon chunks.

Chunks (engine, icon shards) register themselves with `window.__DSHD__.define(name, factory)`, installed by the page shim in `src/cli/html.mjs`. The viewer's loader (`src/viewer/main.js`) asks for `engine.js` and `icons-NNN.js` by name; page data is the `#dshd-data` JSON (`v: 1`, `mode: embedded|remote`).

## Commands

```sh
cd build && npm ci --legacy-peer-deps   # once
cd build && node build.mjs              # everything (CLI, viewer, engine, icon pack if stale)
cd build && node build.mjs client       # viewer + CLI only (needs a prior full build)
npm run check                           # validate examples/web-shop.c4 and examples/reference.c4
npm test                                # unit, CLI and HTML tests (node:test, needs a build)
node skills/dsh-diagram/scripts/diagram.mjs check <file.c4>   # verdict for any diagram
```

The generated files (`skills/dsh-diagram/scripts/`, `skills/dsh-diagram/assets/`, `build/generated/`) are git-ignored. Never edit them by hand: edit `src/` and rebuild. `src/cli/assets.mjs` points at `skills/dsh-diagram/assets/` from the source tree; `build/build.mjs` replaces it in the bundled CLI so the script finds the assets beside it. The engine stays out of the CLI bundle: it is imported from a computed URL.

## Invariants: do not break these

- **One source of rules.** The dependency-free `src/core/vocab.js` defines `RULES`, `KINDS`, `RELATION_KINDS`, `STATES`, `MARKS`, `FORMAT`, `FORMAT_VERSION` and `ROOT_LEAF_KINDS`; the engine re-exports them. They drive the lint, the viewer's state order and the numbers quoted in `SKILL.md`. When one changes, update `SKILL.md` and the README in the same commit. `test/skill.test.mjs` checks the skill's numbers and vocabulary; `test/vocab.test.mjs` checks theme, translation and README coverage.
- **Format header.** Line 1 of every diagram is `// diagram v1` (`FORMAT`, `FORMAT_VERSION`, `formatOf`). Anything else is an error. A breaking format change bumps the version and goes in the CHANGELOG.
- **The diagram directory ignores itself.** `ensureIgnored` writes `.diagram/.gitignore` (`*`). Diagrams can name internal hosts, so they must never reach a project's git history.
- **The skill is part of the API.** `SKILL.md` is what the agent knows. Its example must stay a valid diagram (`npm test` computes it) and neutral (no real hosts, people or projects). It must not depend on anything outside its directory once built.
- **Offline means offline.** Embedded HTML must never fetch a script, icon, font, engine or data from the network. Inline JavaScript and JSON must be escaped against script termination; keep the escaping tests and the 2.5 MB reference-page budget green. The viewer and engine are embedded gzip + base64 (`src/cli/pack.mjs`, inflated by the shim in `src/cli/html.mjs` with `DecompressionStream`); `assembleHtml` refuses anything else, since raw text could close its script element. Offline pages embed `engine-offline.js`, which has no icon index: the page carries `iconIndexFor(sources)` (the entries its own sources read, which resolve the same icons) and the viewer's loader hands it to `setIconIndex` before any parse.
- **Serve only an allowlist.** Bind to loopback by default and warn on a wider bind; reject non-loopback `Host` headers on a loopback bind (DNS rebinding). Map only `/`, the built chunks, the current source and snapshot names matching `^[\w.-]+\.c4$` that are regular files; never resolve an arbitrary request path on disk. `check` writes nothing; only `.diagram/` may get an automatic `.gitignore`.
- **Unfolding is display-only.** Unfolding a group in the viewer never writes the file. Unfolded views may exceed `RULES.viewNodes`; only the file itself is linted.
- **Icons are deterministic and local.** `src/engine/iconmatch.js` maps a label to an icon from the generated index alone: no network, no randomness, the same result in Node and in the browser. Index reads are own-property lookups (a title such as `Constructor` must not reach `Object.prototype`), which is also what keeps `iconIndexFor` exact. The engine only emits ids that exist in the pack (LikeC4 rejects an unknown `icon` reference). Add product names in `src/core/iconrules.js`; `build/icons.mjs` logs any rule whose target is missing from the pack.
- **No private content.** Examples, tests, screenshots and `SKILL.md` use invented systems only (see `examples/web-shop.c4`).

## Testing

- Judge rendering changes on [`examples/reference.c4`](examples/reference.c4): it uses every feature, and comparing the same diagram before and after shows what changed. [`examples/REFERENCE.md`](examples/REFERENCE.md) says where each feature is. `npm run standalone` renders it without creating history.
- Before accepting UI changes, run the complete local gate documented in [README.md](README.md#development): `DSHD_CHROMIUM=/path/to/chrome npm run verify`. It rebuilds and runs core tests plus every browser suite serially; missing browser prerequisites must fail, never silently downgrade to core-only validation. `npm run verify:fast` explicitly excludes the browser. Playwright Core is pinned with the build dependencies; do not add Chromium to CI.
- Check UI changes in light and dark themes, in French and English, and with `prefers-reduced-motion`. Check `file://` with all non-file requests blocked, including unfolding (engine recomputation), history and themes/locales. `test/browser/serve.mjs` covers the live page (updates, invalid edits keeping the last valid drawing, timeline, comparisons, deleted file). Use only invented reference/example systems for screenshots.
- Shared browser drivers belong in `test/support/browser.mjs`; isolate scenario state with fresh contexts. Scene invariants live in `test/support/scene.mjs` and are exercised by the bounded `test/scene-contract.test.mjs` corpus. New regressions need failing-before/passing-after assertions, not only diagnostic scripts or screenshots.
- Releases: add a section to `CHANGELOG.md`; there is no package or tarball. `.github/workflows/ci.yml` builds and runs the core tests on every push and pull request.

## Layout of `src/`

| Path | Role |
|---|---|
| `core/vocab.js` | Dependency-free kinds, states, marks, format constants and readability rules for engine, skill and viewer |
| `core/shared.js` | Pure helpers shared by the CLI, engine and viewer |
| `core/diff.js` | Dependency-free semantic model diff shared by CLI verdicts and viewer comparisons |
| `core/iconrules.js` | Icon name rules (aliases, vendors, glyph words, extensions) and shard naming, shared with the engine and `build/icons.mjs` |
| `engine/entry.mjs` | LikeC4 parse + Graphviz layout, prelude, one generated view per group (+ unfold), state roll-up, lint |
| `engine/scanner.mjs` | Source positions for problems and relation orientation |
| `engine/iconmatch.js` | Icon resolution order and `iconIndexFor` |
| `cli/main.mjs` | Command parsing (`check`, `render`, `serve`), atomic HTML output |
| `cli/verdict.mjs`, `cli/report.mjs` | Validation against the last snapshot and the `[diagram]` verdict text |
| `cli/history.mjs` | Accepted-version snapshots and `.diagram/.gitignore` |
| `cli/html.mjs`, `cli/pack.mjs` | Safe page assembly, page shim, icon selection; gzip + base64 packing |
| `cli/serve.mjs` | Loopback server and its allowlisted API |
| `cli/assets.mjs` | Location of the built assets (replaced in the bundled CLI) |
| `viewer/main.js` | Page entry: chunk loader, page/server data access, theme, header, translations and React mount |
| `viewer/data.js` | Following the source (polled from `serve`), history listing, engine + layout cache |
| `viewer/body.js` | Toolbar (schema tabs, flows, tools, compact mode), breadcrumb, versions group, collapsible legend |
| `viewer/help.js` | `?` popover: mouse gestures and keyboard shortcuts (keep in step with the shipped behaviour) |
| `viewer/stage.js` | Camera, wheel, drag, flights, morph between layouts, details panel clearance; exposes `{flyTo, fit, has, reveal, focus}` |
| `viewer/activation.js`, `viewer/animation.js` | What a click, double-click or footer chip does and token-cancelled animation scheduling |
| `viewer/render.js`, `viewer/shapes.js` | One level of the diagram; boxes, group frames, card stacks, edges |
| `viewer/boxlayout.js` | Pure box header (icon, kind, pill: never overlapping) and group footer chips layout, unit-tested |
| `viewer/zoom.js` | Semantic-zoom geometry, the user-facing fit (`fitView`), reveal framing and panel avoidance |
| `viewer/navigation.js` | Pure spatial focus, accent-insensitive model search and reveal-view helpers |
| `viewer/explorer.js`, `viewer/outline.js` | Explorer panel (search above the outline tree; docked or overlaid) and the keyboard-accessible text tree |
| `viewer/details.js` | Click panel (metadata, links, Fold / Zoom in, trace modes) |
| `viewer/relations.js` | Pure exact-endpoint breadcrumbs and scoped endpoint unfolding |
| [viewer/trace.js](<src/viewer/trace.js>) | Pure exact-graph traversal and view projection; never infer paths from merged edges |
| [viewer/comparison.js](<src/viewer/comparison.js>), [viewer/changes.js](<src/viewer/changes.js>) | Displayed-source baseline resolution and neutral observed-change projection; deletions never create layout nodes |
| [viewer/change-panel.js](<src/viewer/change-panel.js>) | Comparison controls and removal/link disclosures |
| `viewer/copy.js` | UI strings (`en`, `fr`, `zh`; identical keys) |
| `viewer/style.js`, `viewer/theme.js`, `viewer/icons.js` | CSS (`dshd-` prefix, `--dshd-*` palette), theme colours in vocabulary order, UI icons |
| `viewer/iconpack.js` | Loads the `icons-NNN.js` shards a diagram needs and draws an icon (`IconMark`) |
