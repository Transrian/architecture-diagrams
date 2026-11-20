# AGENTS.md

Guide for agents (and humans) changing dsh-diagram. User-facing docs live in [README.md](README.md); this file covers what you need to change the code safely.

**Local overlay.** If `AGENTS.local.md` exists next to this file, read it too. It holds notes for one machine: where DSH runs, how to restart it, how the plugin is linked, local test tooling. Its rules take precedence over this file for anything about that machine. The file is git-ignored: never commit it, and never copy its contents (hosts, paths, names) into tracked files. DSH loads it automatically; other agents have to open it.

## What this is

This is a DeepSeek Harness (DSH) bundle in two halves that share one engine:

| Half | Entry | Runs in | Reloaded by |
|---|---|---|---|
| Host | `index.js` | the DSH Node process | a DSH restart (`systemctl restart dsh` or equivalent) |
| Client | `src/` → bundled into `client.js` | the browser, as a module-loader module | a page refresh |
| Engine | `build/entry.mjs` → `lib/likec4.mjs` (host) + `client.likec4.js` (lazy browser chunk) | both | both of the above |

Data flow: the agent edits `<workspace>/.diagram/<root session>.c4`. After every tool call, the host notices the change, validates the file with the engine, and appends a `[diagram]` note to that tool result. It also snapshots accepted versions, gives the agent a link to the file (a click opens the tab), and writes SVG previews when `previews` is on (off by default). The client follows the same file through DSH's `useResource` hook (pushed by the Host's `workspaceFiles.changes` watch; polling `stat` only on a DSH without the hook), reads it through `remote.workspaceFiles`, and renders it.

## Commands

```sh
cd build && npm ci --legacy-peer-deps   # once
cd build && node build.mjs              # client + engine (about 10 s)
cd build && node build.mjs client       # client only (about 1 s)
npm run check                           # validate examples/web-shop.c4
npm test                                # host tests (node:test, needs a build)
node check.mjs <file.c4>                # verdict for any diagram, without DSH
```

The generated files (`client.js`, `client.likec4.js`, `lib/`) are git-ignored. Never edit them by hand: edit `src/` or `build/entry.mjs` and rebuild.

## Invariants: do not break these

- **One source of rules.** `RULES`, `KINDS`, `STATES` and `MARKS` in `build/entry.mjs` drive the lint, the client legend and the numbers quoted in the prompt (`promptText` in `index.js`). When one changes, update the prompt and the README in the same commit.
- **Format header.** Line 1 of every diagram is `// diagram v1` (`FORMAT`, `FORMAT_VERSION`, `formatOf`). Old `// carte v2` files must keep loading: that is the same format under the plugin's former name. A breaking format change bumps the version, keeps reading the previous one where it can, and goes in the CHANGELOG.
- **The diagram directory ignores itself.** `ensureIgnored` writes `<dir>/.gitignore` (`*`). Diagrams can name internal hosts, so they must never reach a project's git history.
- **The prompt is part of the API.** Agents only learn the format from `promptText`. Its example must stay a valid diagram (`npm test` checks it). Keep the example neutral (no real hosts, people or projects).
- **Unfolding is display-only.** Unfolding a group in the tab never writes the file. Unfolded views may exceed `RULES.viewNodes`; only the file itself is linted.
- **Fail soft on DSH changes.** On the host, a missing Session field disables the feature with a single `warnOnce` log line instead of throwing on every turn. Follow that pattern when you touch a new DSH surface.
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
- The client has no unit tests. Check UI changes in a browser (the Playwright + Chromium pair works well), in light and dark themes, in French and English, and with `prefers-reduced-motion`.

## Layout of `src/`

| File | Role |
|---|---|
| `main.js` | Registration: locale, styles, tab, slots |
| `body.js` | Toolbar, schema buttons, breadcrumb, timeline, legend, PNG button |
| `stage.js` | Camera, wheel, clicks, flights, morph between layouts; exposes `{flyTo, fit, has, snapshot}` |
| `render.js`, `shapes.js` | One level of the diagram; boxes, group frames, card stacks, edges |
| `zoom.js` | Semantic-zoom geometry (where each group's view sits inside its parent) |
| `details.js` | Click panel (metadata, links, Fold / Zoom in) |
| `export.js` | PNG: clone the SVG, inline computed styles, crop, add title and legend, rasterize |
| `data.js` | Following the file (`useResource`, polling fallback), `.ref` pointers, history listing, engine chunk + layout cache |
| `copy.js` | UI strings (`en`, `fr`, `zh`; other locales fall back to `en`) |
| `style.js`, `theme.js`, `icons.js`, `shared.js` | CSS (`dshd-` prefix), theme colours, icons, helpers shared with the engine |
