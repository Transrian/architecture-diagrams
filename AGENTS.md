# AGENTS.md

Guide for agents (and humans) changing dsh-diagram. User-facing docs live in [README.md](README.md); this file covers what you need to change the code safely.

**Local overlay.** If `AGENTS.local.md` exists next to this file, read it too. It holds notes for one machine: where DSH runs, how to restart it, how the plugin is linked, local test tooling. Its rules take precedence over this file for anything about that machine. The file is git-ignored: never commit it, and never copy its contents (hosts, paths, names) into tracked files. DSH loads it automatically; other agents have to open it.

## What this is

This is a DeepSeek Harness (DSH) bundle and standalone CLI that share one engine and viewer:

| Half | Entry | Runs in | Reloaded by |
|---|---|---|---|
| Host | `index.js` | the DSH Node process | a DSH restart (`systemctl restart dsh` or equivalent) |
| Client | `src/main.js` → bundled into `client.js` | the browser, as a module-loader module | a page refresh |
| Standalone | `bin/`, `cli/`, `src/standalone.js` → `lib/standalone.js` | Node CLI and browser on `file://` or localhost | `node build.mjs client`, then a new `render` (or refresh `serve`) |
| Engine | `build/entry.mjs` → `lib/likec4.mjs` (host) + `client.likec4.js` (lazy browser chunk) + `lib/likec4.export.js` (same chunk without the icon index, for offline HTML) | both | both of the above |

Data flow: the agent edits `<workspace>/.diagram/<root session>.c4`. After every tool call, the host notices the change, validates the file with the engine, and appends a `[diagram]` note to that tool result. It also snapshots accepted versions and gives the agent a link to the file (a click opens the tab). The client follows the same file through DSH's `useResource` hook (pushed by the Host's `workspaceFiles.changes` watch; polling `stat` only on a DSH without the hook), reads it through `remote.workspaceFiles`, and renders it.

## Commands

```sh
cd build && npm ci --legacy-peer-deps   # once
cd build && node build.mjs              # client + engine (about 10 s)
cd build && node build.mjs client       # client only (about 1 s)
npm run check                           # validate examples/web-shop.c4 and examples/reference.c4
npm test                                # host tests (node:test, needs a build)
node check.mjs <file.c4>                # verdict for any diagram, without DSH
```

The generated files (`client.js`, `client.likec4.js`, `client.export-html.js`, `client.icons-*.js`, `lib/`, `build/generated/`) are git-ignored. Never edit them by hand: edit `src/` or `build/entry.mjs` and rebuild.

## Invariants: do not break these

- **One source of rules.** The dependency-free `src/vocab.js` defines `RULES`, `KINDS`, `STATES`, `MARKS`, `FORMAT`, `FORMAT_VERSION` and `ROOT_LEAF_KINDS`; the engine re-exports them. They drive the lint, the client state order and the numbers quoted in the prompt (`formatGuide` / `promptText` in `prompt.js`). When one changes, update the prompt and the README in the same commit. `test/vocab.test.mjs` checks theme, translation, guide and README coverage without a build.
- **Format header.** Line 1 of every diagram is `// diagram v1` (`FORMAT`, `FORMAT_VERSION`, `formatOf`). Old `// carte v2` files must keep loading: that is the same format under the plugin's former name. A breaking format change bumps the version, keeps reading the previous one where it can, and goes in the CHANGELOG.
- **The diagram directory ignores itself.** `ensureIgnored` writes `.diagram/.gitignore` (`*`). Diagrams can name internal hosts, so they must never reach a project's git history.
- **The prompt is part of the API.** `prompt.js` shares `formatGuide` between the DSH prompt and the skill: format edits affect both. The root and subagent DSH prompts are tested byte-for-byte against fixtures. Guide examples must stay valid diagrams (`npm test` checks them). Keep them neutral (no real hosts, people or projects).
- **Offline means offline.** Embedded HTML must never fetch a script, icon, font, engine or data from the network. Inline JavaScript and JSON must be escaped against script termination; keep the escaping tests and the 2.5 MB reference-page budget green. The viewer and engine are embedded gzip + base64 (`cli/pack.mjs`, inflated by the shim in `src/html.js` with `DecompressionStream`); `assembleHtml` refuses anything else, since raw text could close its script element. Offline pages embed `lib/likec4.export.js`, which has no icon index: the page carries `iconIndexFor(sources)` (the entries its own sources read, which resolve the same icons) and the standalone loader hands it to `setIconIndex` before any parse.
- **Serve only an allowlist.** Bind to loopback by default and warn on a wider bind. Map only the fixed virtual current/history paths and built chunks; never resolve an arbitrary request path on disk. `check` writes nothing; only `.diagram/` may get an automatic `.gitignore`.
- **One viewer, two entries.** `src/standalone.js` must not import `main.js` or DSH registration. It uses the shared body/data/renderer, bundles one production React, and sets both loaders. The DSH client must keep React external and must not contain standalone code.
- **Unfolding is display-only.** Unfolding a group in the tab never writes the file. Unfolded views may exceed `RULES.viewNodes`; only the file itself is linted.
- **Fail soft on DSH changes.** On the host, a missing Session field disables the feature with a single `warnOnce` log line instead of throwing on every turn. Follow that pattern when you touch a new DSH surface.
- **Icons are deterministic and local.** `src/iconmatch.js` maps a label to an icon from the generated index alone: no network, no randomness, the same result on the Host and in the browser. Index reads are own-property lookups (a title such as `Constructor` must not reach `Object.prototype`), which is also what keeps `iconIndexFor` exact. The engine only emits ids that exist in the pack (LikeC4 rejects an unknown `icon` reference). Add product names in `src/iconrules.js`; `build/icons.mjs` logs any rule whose target is missing from the pack.
- **No private content.** Examples, tests, screenshots and the prompt use invented systems only (see `examples/web-shop.c4`).

## DSH surfaces used

DSH is pre-1.0 and changes weekly. This list is what can break, mirrored in the README's Compatibility table:

- Host: `ctx.inject(['systemPrompt'])` + `systemPrompt.section`, `ctx.on('tools/post-execute')`, `ctx.on('agent/created')`, `agent.session.{id, header.cwd, header.origin, header.parentSession}`, `ctx.agents.get`.
- Client: `window.__ModuleLoader__.load` + `require.async`, `ctx.sidebarRightTabs.register` (with `patterns`/`canOpen`, so links to `.diagram/*.c4` open the tab; a tab opened that way hands over to the Diagram page through `useTabInfo().tab.{contentId, actions}`), `ctx.slots` (`sidebar.right.pane.tab`, `sidebar.right.pane.tab.title`), the `useResource` slot prop on `dsh-resource://file/session/<id>/<path>` addresses (DSH's file provider over `workspaceFiles.changes`), `ctx.remote.workspaceFiles.{stat, read, list}` (`list` is workspace-scoped, which is why diagrams live in the workspace), `ctx.locale.{register, bind}`, and React from the loader.
- Manifest: the `dsh` block in `package.json` (`bundle.patch`, `client.inject`) and `cordis.patch.yml`.

The DSH package READMEs are the reference. Read them in an installed DSH (`node_modules/@deepseek-ai/dsh-*/README.md`): start with `dsh-tools`, `dsh-system-prompt`, `dsh-api-workspace-files`, `dsh-package-manifest`, `dsh-plugin-manager` and `dsh-app-boot`.

## Compatibility and releases

- `engines.dsh` in `package.json` is the supported range. DSH enforces it at install and at startup. Widen it only after testing on the new DSH: install, open the tab, let an agent write a diagram, and check that the `[diagram]` note arrives.
- To release:
  1. Bump `version` in `package.json`.
  2. Add a `## X.Y.Z` section to `CHANGELOG.md`.
  3. Commit, then `git tag vX.Y.Z && git push --follow-tags`.

  `.github/workflows/release.yml` then builds and tests, runs `npm pack`, and attaches `dsh-diagram-X.Y.Z.tgz` to a GitHub Release. Users install it with `dsh plugin --profile web add <tarball URL>`.
- `.github/workflows/ci.yml` builds and tests every push and pull request.

## Testing in a live DSH

- Link a checkout into a profile: `dsh plugin --profile web add link:$PWD`, or have the agent run `plugin_manager install_bundle` with `link:<path>`.
- Client changes: rebuild, then refresh the page. Host changes: restart DSH.
- Judge rendering changes on [`examples/reference.c4`](examples/reference.c4): it uses every feature, and comparing the same diagram before and after shows what changed. [`examples/REFERENCE.md`](examples/REFERENCE.md) says where each feature is.
- Client React interactions have no unit tests. Check UI changes in a browser (the Playwright + Chromium pair works well), in light and dark themes, in French and English, and with `prefers-reduced-motion`.

## Standalone development

- `prompt.js`, `report.js` and `history.js` are shared by the host and CLI. Keep the engine lazily loaded from the host; the prompt module must not import it.
- `bin/dsh-diagram.mjs` parses commands; `cli/verdict.mjs` validates, `cli/html.mjs` reads assets and filtered icons, `src/html.js` assembles safe HTML for both the CLI and DSH export, `cli/serve.mjs` serves the allowlist, and `cli/skill.mjs` installs the generated Agent Skills document.
- DSH HTML export uses `src/export-html.js` and the lazy data-only `client.export-html.js` chunk. Keep it out of the standalone dependency graph (no recursive embedding) and pair exported source with the displayed valid layout, not a fresh read of the live file.
- Build both clients with `cd build && node build.mjs client`; run `npm run standalone` for an offline reference HTML. The complete build also regenerates the engine and icon pack. Include every imported source helper in the package `files` list (the CLI uses `src/iconrules.js`).
- `npm test` includes CLI/HTTP/security, HTML escaping/icon coverage/size, and prompt golden tests. `npm run check` must also pass. `test/browser/standalone.mjs` is an optional Playwright smoke test, skipped unless `DSHD_CHROMIUM` points to a full Chromium executable. It needs a locally available `playwright-core`; do not add Chromium to CI.
- Check `file://` with all non-file requests blocked, including unfolding (engine recomputation), history and themes/locales. Verify that PNG export is absent from both entries. For `serve`, check live updates and invalid edits retaining the last valid drawing. Use only invented reference/example systems for screenshots.

## Layout of `src/`

| File | Role |
|---|---|
| `main.js` | Registration: locale, styles, tab, slots |
| `standalone.js` | Offline/live browser entry: loader, virtual file API, theme, header, translations and React mount |
| `body.js` | Toolbar (schema tabs, flows, tools, compact mode), breadcrumb, versions group, collapsible legend, DSH HTML export button |
| `help.js` | `?` popover: mouse gestures and keyboard shortcuts (keep in step with the shipped behaviour) |
| `stage.js` | Camera, wheel, drag, flights, morph between layouts, details panel clearance; exposes `{flyTo, fit, has, reveal, focus}` |
| `activation.js`, `animation.js` | What a click, double-click or footer chip does (details at once, unfold/fold in place, fly to a neighbour) and token-cancelled animation scheduling |
| `render.js`, `shapes.js` | One level of the diagram; boxes, group frames, card stacks, edges |
| `boxlayout.js` | Pure box header (icon, kind, pill: never overlapping) and group footer chips layout, unit-tested |
| `zoom.js` | Semantic-zoom geometry (where each group's view sits inside its parent), the user-facing fit (`fitView`), reveal framing and panel avoidance |
| `navigation.js` | Pure spatial focus, accent-insensitive model search and reveal-view helpers |
| `explorer.js`, `outline.js` | Explorer panel (search field above the outline tree; docked or overlaid) and the keyboard-accessible text tree |
| `details.js` | Click panel (metadata, links, Fold / Zoom in) |
| `relations.js` | Pure exact-endpoint breadcrumbs and scoped endpoint unfolding |
| `export.js` | HTML download: browser Blob download and safe timestamped file names |
| `html.js` | Safe offline HTML assembly shared by the CLI and DSH export |
| `export-html.js` | DSH-only HTML export adapter: displayed source/layout pair and lazy export assets |
| `data.js` | Following the file (`useResource`, polling fallback), `.ref` pointers, history listing, engine chunk + layout cache |
| `copy.js` | UI strings (`en`, `fr`, `zh`; other locales fall back to `en`) |
| `vocab.js` | Dependency-free kinds, states, marks, format constants and readability rules for engine, prompt and viewer |
| `style.js`, `theme.js`, `icons.js` | CSS (`dshd-` prefix), theme colours in vocabulary order, UI icons |
| `shared.js` | Pure helpers shared by host, CLI, engine and viewer |
| `diff.js` | Dependency-free semantic model diff shared by host, CLI and viewer comparisons |
| [trace.js](<src/trace.js>) | Pure exact-graph traversal and view projection; never infer paths from merged edges |
| [comparison.js](<src/comparison.js>), [changes.js](<src/changes.js>) | Displayed-source baseline resolution and neutral observed-change projection; deletions never create layout nodes |
| [change-panel.js](<src/change-panel.js>) | Comparison controls and removal/link disclosures; runtime state is not exported |
| `iconrules.js`, `iconmatch.js` | Box icons: name rules (aliases, vendors, glyph words, extensions) and the resolution order, shared with the engine and `build/icons.mjs` |
| `iconpack.js` | Loads the `client.icons-NNN.js` shards a diagram needs and draws an icon (`IconMark`) |
