# dsh-diagram

A live architecture diagram for every [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (DSH) conversation.

The agent keeps a small [LikeC4](https://likec4.dev) model of what the conversation is about. The **Diagram** tab in the right sidebar draws it as you talk. The diagram answers two questions at a glance:

- **How is it built?** The architecture, as nested groups you zoom into one level at a time.
- **What will the agent touch?** The same elements, tagged `planned`, `doing`, `done`, `blocked`… as the work goes on.

![The Diagram tab: examples/web-shop.c4 with Frontend and Checkout unfolded in place](docs/screenshot.png)

It is not a log. There are no task boxes and no history in the drawing. Reasons, numbers, commits and test results go into metadata, which you see when you click a box.

## Features

- **Schemas.** Each top-level group is a schema and gets a button at the top of the tab. Unrelated subjects go in separate schemas.
- **Semantic zoom.** The whole diagram is one canvas. Scroll over a collapsed group and it grows, slides to the centre and turns into its own view, while the rest fades out. Scroll back out to return to the overview. The breadcrumb and the schema buttons fly you there with an animation.
- **Unfold in place.** Click a collapsed group to open it inside the current view. Boxes slide from the old layout to the new one. Use `− Fold`, or **Fold all**, to close groups again. This only changes the display: nothing is written to the file.
- **Groups stand out.** A collapsed group is drawn as a stack of cards in teal, with `⊕ N` (how many elements it holds) and the dominant state of what is inside (`· 2 planned +3`).
- **Merged links.** Several relations between two collapsed boxes show as one edge labelled "3 links". Click it to see the details.
- **Timeline.** Every accepted version is kept. Step back through earlier versions from the toolbar.
- **PNG export.** `⤓ PNG` saves the current view: unfolded groups, zoom and theme included. The image is cropped to the content, about 2000 px on its long side, and gets a title, a date and a legend of the states shown.
- **Previews in messages.** Each accepted version also produces one SVG per schema. The agent can embed them in its replies, so you see the diagram without opening the tab.
- **Readability rules.** The plugin refuses a diagram that is too heavy to read, and the agent gets the list of what to fix. The rules: at most 7 children per group, 4 levels, 60 elements and 16 boxes per view, plus short labels.

## Install

The plugin is a DSH bundle. The engine and client files are generated at build time and not committed, so build once after cloning:

```sh
git clone https://github.com/Transrian/dsh-diagram.git
cd dsh-diagram/build
npm ci --legacy-peer-deps
node build.mjs          # → ../client.js, ../client.likec4.js, ../lib/likec4.mjs
```

Then add it to your DSH profile as a linked directory. Either:

- run `dsh plugin --profile web add link:/absolute/path/to/dsh-diagram`, or
- ask the agent: *"install the bundle `link:/absolute/path/to/dsh-diagram` with plugin_manager"*.

Refresh the page. The **Diagram** tab appears in the right sidebar, and agents start drawing in new turns.

Once a release tarball is published (`npm pack` already includes the built files), DSH can install it directly: `dsh plugin --profile web add <tarball URL>`.

## Where the diagrams live

```
<workspace>/.diagram/
├── .gitignore                    "*": the directory ignores itself, no project config needed
├── <session>.c4                  the diagram of one conversation (written by the agent)
├── <subagent>.ref                points a subagent's tab at its root conversation
└── <session>/
    ├── 0001-<date>.c4 …          every accepted version (the timeline)
    └── previews/v<N>-<schema>.svg
```

Diagrams can name internal hosts or services, so they never reach git. The plugin creates `.diagram/.gitignore` itself the first time a diagram is written.

## How it works

```
agent ──writes──▶ <workspace>/.diagram/<root session>.c4      (first line: // diagram v1)
                      │
   Host (index.js)    │ after every tool call: parse + readability rules
                      │   → "[diagram] v<N> valid" + SVG preview paths,
                      │     or syntax errors, or a refusal (too heavy to read)
                      │   + snapshot .diagram/<id>/NNNN-<date>.c4
   Client (client.js) │ re-reads the file every 2 s → LikeC4 parse + Graphviz (wasm)
                      │ in the browser → zoomable SVG
```

- The **host half** adds a section to every agent's system prompt (where the file is, the format, the rules). After each tool call it notices a changed diagram, validates it, and appends a short `[diagram]` verdict to that tool result. One diagram exists per root conversation: subagents write to their root's file.
- The **client half** registers the right-sidebar tab. It reads the file through DSH's workspace-files API, and lays it out with the same engine in a lazily loaded chunk.

### File format

The first line must be `// diagram v1`. The rest is LikeC4 `model { }`, plus `views { }` for dynamic views only. The plugin generates one view per group itself.

| | |
|---|---|
| kinds | `system` (schema or group), `machine`, `service`, `component`, `data`, `doc`, `person`, `external`, `hardware` |
| states | `#planned` `#doing` `#done` `#impacted` `#deviation` `#blocked` `#waiting` `#frozen` (one per element) |
| marks | `#new` `#removed` (combine with a state) |
| metadata | `why`, `decided` (`agent` / `user`), `proof`; any other key is shown as is |

Files from the plugin's earlier name (`// carte v2`) are read as the same format. See [`examples/web-shop.c4`](examples/web-shop.c4) for a complete diagram.

## Configuration

Optional fields on the plugin's row in the profile's `cordis.patch.yml`:

| Field | Default | Meaning |
|---|---|---|
| `dir` | `.diagram` | Diagram directory, relative to the conversation's workspace |
| `lang` | `en` | Language of the state labels in SVG previews (`en`, `fr`). The tab follows the DSH interface language. |
| `prompt` | `true` | Add the system prompt section |
| `history` | `true` | Keep a snapshot of every accepted version |
| `previews` | `true` | Write SVG previews for messages |
| `maxErrors` | `8` | Errors listed per `[diagram]` note |

## Compatibility

DSH is young and its plugin surface still moves. `package.json` declares `"engines": { "dsh": ">=0.2.2-rc.1 <0.3.0" }`. DSH checks that range when the plugin is installed and again at startup. Outside it, the plugin is not loaded rather than crashing. To try it anyway, grant a per-version exemption with `dsh plugin --profile web allow-version dsh-diagram@<version> --dsh-version <runtime> --accept-risk`.

These are the DSH APIs the plugin relies on. If a DSH update breaks the plugin, look here first:

| Side | DSH surface |
|---|---|
| Host | `ctx.inject(['systemPrompt'])` → `systemPrompt.section({ name, order, text })` |
| Host | `ctx.on('tools/post-execute', (exec, result, next) => …)`, `ctx.on('agent/created', …)` |
| Host | `agent.session.id`, `session.header.{cwd, origin, parentSession}`, `ctx.agents.get(id)` |
| Client | `window.__ModuleLoader__.load({ id, chunk, factory })`, lazy `require.async(chunk)` |
| Client | `ctx.sidebarRightTabs.register`, `ctx.slots` (`sidebar.right.pane.tab`, `…tab.title`) |
| Client | `ctx.remote.workspaceFiles.{stat, read, list}`, `ctx.locale.{register, bind}`, React via the loader |

When a host-side field is missing, the feature turns itself off with one warning in the DSH log, instead of failing on every turn.

Tested on DSH 0.2.2-rc.1.

## Development

| Path | Role |
|---|---|
| `index.js` | Host half: prompt section, `tools/post-execute` check, history, previews, `.ref` pointers |
| `src/` | Client half: `main` (registration), `body` (toolbar, breadcrumb, legend), `stage` (camera, wheel, clicks, flights), `render` (one level + morph), `zoom` (semantic-zoom geometry), `shapes`, `details`, `export` (PNG), `data` (file, timeline, engine), `copy` (UI strings), `style`, `theme`, `shared` |
| `build/entry.mjs` | Engine shared by host and browser: prelude, one view per group (+ unfold), state roll-up, readability rules, static SVG |
| `build/build.mjs` | Bundles `src/` → `client.js`, and the engine → `lib/likec4.mjs` (host) + `client.likec4.js` (browser chunk) |
| `check.mjs` | `node check.mjs <file.c4>`: the same verdict as the host, without DSH |

- `cd build && node build.mjs client` rebuilds only `client.js` (about a second). A page refresh picks it up.
- Changes to `index.js` or `lib/likec4.mjs` need a DSH restart.
- Generated files (`client.js`, `client.likec4.js`, `lib/`) are not committed.

## License

[MIT](LICENSE)
