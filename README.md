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
- **Icons, automatically.** Each box shows the logo of its product (Kafka, PostgreSQL, Snowflake, vLLM, Lambda…), picked from its `technology` field or its title. Cloud services resolve inside a group named after their vendor ("Functions" under Azure). With no product, a generic glyph from the words of the label stands in (queue, cache, database, DNS, firewall…, in English or French), else a glyph of the element's kind. See [Icons](#icons).
- **Groups stand out.** A collapsed group is drawn as a stack of cards in teal, with `⊕ N` (how many elements it holds) and the dominant state of what is inside (`· 2 planned +3`).
- **Merged links.** Several relations between two collapsed boxes show as one edge labelled "3 links". Click it to see the details.
- **Timeline.** Every accepted version is kept. Step back through earlier versions from the toolbar.
- **PNG export.** `⤓ PNG` saves the current view: unfolded groups, zoom and theme included. The image is cropped to the content, about 2000 px on its long side, and gets a title, a date and a legend of the states shown.
- **Links open the tab.** The agent links the diagram file in its reply. Clicking that link, or any other link to a `.diagram/*.c4` file, opens the Diagram tab (or brings it forward) instead of a text preview. The tab always shows the current version.
- **Readability rules.** The plugin refuses a diagram that is too heavy to read, and the agent gets the list of what to fix. The rules: at most 7 children per group, 6 levels and 16 boxes per view, plus short labels. There is no limit on the total number of elements: the zoom shows one level at a time, so a whole cloud platform fits.

## Install

Requires DSH `>=0.2.2-rc.1 <0.3.0`.

**From a release** (recommended). Each [release](https://github.com/Transrian/dsh-diagram/releases) ships a ready-to-install tarball:

```sh
dsh plugin --profile web add https://github.com/Transrian/dsh-diagram/releases/download/v0.1.0/dsh-diagram-0.1.0.tgz
```

Refresh the page. The **Diagram** tab appears in the right sidebar, and agents start drawing in new turns. To upgrade, run the same command with the newer release URL.

**From source**, to hack on it. The built files are not committed, so build once after cloning, then link the directory into your profile:

```sh
git clone https://github.com/Transrian/dsh-diagram.git
cd dsh-diagram/build && npm ci --legacy-peer-deps && node build.mjs && cd ..
dsh plugin --profile web add link:$PWD
```

You can also ask the agent to install the bundle with `plugin_manager`, giving it the tarball URL or `link:<path>`.

## Where the diagrams live

```
<workspace>/.diagram/
├── .gitignore                    "*": the directory ignores itself, no project config needed
├── <session>.c4                  the diagram of one conversation (written by the agent)
├── <subagent>.ref                points a subagent's tab at its root conversation
└── <session>/
    └── 0001-<date>.c4 …          every accepted version (the timeline)
```

Diagrams can name internal hosts or services, so they never reach git. The plugin creates `.diagram/.gitignore` itself the first time a diagram is written.

## How it works

```
agent ──writes──▶ <workspace>/.diagram/<root session>.c4      (first line: // diagram v1)
                      │
   Host (index.js)    │ after every tool call: parse + readability rules
                      │   → "[diagram] v<N> valid" + link to the file,
                      │     or syntax errors, or a refusal (too heavy to read)
                      │   + snapshot .diagram/<id>/NNNN-<date>.c4
   Client (client.js) │ pushed on change (DSH file watch) → LikeC4 parse + Graphviz (wasm)
                      │ in the browser → zoomable SVG
```

- The **host half** adds a section to every agent's system prompt (when to draw, where the file is, the format, the rules). The agent draws when the user asks for a diagram, or when its plan spans several components or too many changes to picture in text; it skips simple questions and small changes. After each tool call it notices a changed diagram, validates it, and appends a short `[diagram]` verdict to that tool result. One diagram exists per root conversation: subagents write to their root's file.
- The **client half** registers the right-sidebar tab. It follows the file through DSH's resource hook (`useResource`, fed by the Host's file watch), so a new version shows as soon as it is written. It reads it through the workspace-files API and lays it out with the same engine in a lazily loaded chunk.

### File format

The first line must be `// diagram v1`. The rest is LikeC4 `model { }`, plus `views { }` for dynamic views only. The plugin generates one view per group itself.

| | |
|---|---|
| kinds | `system` (schema or group), `machine`, `service`, `component`, `data`, `doc`, `person`, `external`, `hardware` |
| states | `#planned` `#doing` `#done` `#impacted` `#deviation` `#blocked` `#waiting` `#frozen` (one per element) |
| marks | `#new` `#removed` (combine with a state) |
| metadata | `why`, `decided` (`agent` / `user`), `proof`; any other key is shown as is |

Files from the plugin's earlier name (`// carte v2`) are read as the same format. See [`examples/web-shop.c4`](examples/web-shop.c4) for a small diagram, and [`examples/reference.c4`](examples/reference.c4) for one that uses every feature ([where each one is](examples/REFERENCE.md)).

### Icons

The agent does not pick icons: the plugin does, the same way every time. First hit wins:

1. `icon <set>:<name>` written on the element (LikeC4 ids: `aws:`, `azure:`, `gcp:`, `tech:`, `bootstrap:`), or `icon none`.
2. The `technology` field, matched against product names ("PostgreSQL 16", "Apache Kafka", "Kafka, Avro"). Case, accents, punctuation and version numbers are ignored.
3. The title, more strictly: a product named like a common word ("Spark", "Vault") matches only a title that is just that name. A file name ("Cart.tsx", "main.py") gets its language.
4. A generic glyph from the words of the label: queue, cache, database, bucket, DNS, load balancer, firewall, scheduler… (English and French).
5. A glyph of the kind (`data`, `machine`, `hardware`, `doc`, `external`, `service`, `component`), for leaf boxes only.

Cloud service names ("Lambda", "Functions", "Storage") use the vendor's own icons when the element or one of its groups names the vendor (AWS, Azure, GCP); unambiguous ones (EKS, DynamoDB, BigQuery, S3) work anywhere. The `[diagram]` note tells the agent which technologies found no icon and which icons came from a title alone, once per change, so a codename that looks like a product can get `icon none`.

Everything is local: about 10 000 icons are bundled with the plugin and the browser loads only the ones a diagram shows. They come from [LikeC4's icon sets](https://github.com/likec4/likec4/tree/main/packages/icons) (AWS, Azure, GCP, tech logos, Bootstrap Icons), [Lobe Icons](https://github.com/lobehub/lobe-icons) (AI products), [Simple Icons](https://simpleicons.org) and [selfh.st icons](https://selfh.st/icons/) (self-hosted and infrastructure software). The name rules live in [`src/iconrules.js`](src/iconrules.js); a new product name is usually one line there. Logos are trademarks of their owners.

## Configuration

Optional fields on the plugin's row in the profile's `cordis.patch.yml`:

| Field | Default | Meaning |
|---|---|---|
| `dir` | `.diagram` | Diagram directory, relative to the conversation's workspace |
| `prompt` | `true` | Add the system prompt section |
| `history` | `true` | Keep a snapshot of every accepted version |
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
| Client | `ctx.sidebarRightTabs.register` (with `patterns` + `canOpen` for `.diagram/*.c4` links), `ctx.slots` (`sidebar.right.pane.tab`, `…tab.title`), `useTabInfo` (`tab.contentId`, `tab.actions.{openTab, close}`) |
| Client | `useResource` slot prop on `dsh-resource://file/session/…` (backed by `workspaceFiles.changes`; polling fallback without it) |
| Client | `ctx.remote.workspaceFiles.{stat, read, list}`, `ctx.locale.{register, bind}`, React via the loader |

When a host-side field is missing, the feature turns itself off with one warning in the DSH log, instead of failing on every turn.

Tested on DSH 0.2.2-rc.1.

## Development

| Path | Role |
|---|---|
| `index.js` | Host half: prompt section, `tools/post-execute` check, history, `.ref` pointers |
| `src/` | Client half: `main` (registration), `body` (toolbar, breadcrumb, legend), `stage` (camera, wheel, clicks, flights), `render` (one level + morph), `zoom` (semantic-zoom geometry), `shapes`, `details`, `export` (PNG), `data` (file, timeline, engine), `copy` (UI strings), `style`, `theme`, `shared` |
| `build/entry.mjs` | Engine shared by host and browser: prelude, one view per group (+ unfold), state roll-up, readability rules |
| `build/build.mjs` | Bundles `src/` → `client.js`, and the engine → `lib/likec4.mjs` (host) + `client.likec4.js` (browser chunk) |
| `build/icons.mjs` | Icon pack: merges the icon sets into `build/generated/icon-index.json` (names → ids, in the engine) and 256 `client.icons-NNN.js` chunks (SVGs, loaded on demand) |
| `src/iconrules.js`, `src/iconmatch.js` | Icon name rules (aliases, vendors, glyph words) and the resolution order |
| `check.mjs` | `node check.mjs <file.c4>`: the same verdict as the host, without DSH |
| `test/` | Host tests against a fake DSH context, and coverage of the reference diagram: `npm test` (after a build) |

- `cd build && node build.mjs client` rebuilds only `client.js` (about a second). A page refresh picks it up.
- Changes to `index.js` or `lib/likec4.mjs` need a DSH restart.
- Generated files (`client.js`, `client.likec4.js`, `client.icons-*.js`, `lib/`, `build/generated/`) are not committed. The icon pack is rebuilt only when its sets, rules or generator change.
- Contributor and agent notes (invariants, DSH surfaces, release steps): [AGENTS.md](AGENTS.md). Changes per version: [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE). The bundled icons keep their own licenses, listed at the end of [LICENSE](LICENSE).
