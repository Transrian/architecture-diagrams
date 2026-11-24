// Builds the generated half of the skill, ../skills/architecture-diagrams/:
//   scripts/diagram.mjs   CLI (../src/cli), bundled for Node
//   assets/viewer.js      viewer page script (../src/viewer), including production React
//   assets/engine.mjs     engine (../src/engine) as an ES module, for the CLI
//   assets/engine.js      engine chunk, served by `serve`
//   assets/engine-offline.js  same chunk without the icon index, embedded in offline HTML (which carries the used part)
//   assets/icons-NNN.js   icon pack shards (icons.mjs), loaded for the icons shown
//   generated/icon-index.json  product name → icon id, bundled into the engine
// The engine bundles replace LikeC4 dependencies they never run with ./stubs.
// `node build.mjs client` rebuilds the viewer and the CLI only (fast).
// The icon pack is regenerated only when its inputs change (sets, rules, generator).
import { build } from 'esbuild'
import { writeFile, readFile, mkdir, readdir, unlink, chmod } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateIcons } from './icons.mjs'
import { shardFile } from '../src/core/iconrules.js'

// Every input/output path below is relative to this script, not the caller's cwd.
const BUILD_DIR = path.dirname(fileURLToPath(import.meta.url))
process.chdir(BUILD_DIR)

const SKILL = '../skills/architecture-diagrams'
const ASSETS = `${SKILL}/assets`
const only = process.argv[2]
// ../src lives outside build/: resolve its bare imports from build/node_modules.
const common = {
  absWorkingDir: BUILD_DIR,
  bundle: true,
  logLevel: 'warning',
  legalComments: 'none',
  nodePaths: [path.resolve('node_modules')],
}

/** Wraps a CommonJS bundle body into a chunk that registers itself with the page shim (src/cli/html.mjs). */
const chunk = (name, body) =>
  `window.__ARCHD__.define(${JSON.stringify(name)}, () => {\n` +
  '\tvar module = { exports: {} };\n\tvar exports = module.exports;\n' +
  `${body}\n\treturn module.exports;\n});\n`

await mkdir(`${SKILL}/scripts`, { recursive: true })
await mkdir(ASSETS, { recursive: true })

// Pin both packages to the build-time installation: a workspace may have its own React.
const viewer = await build({
  ...common,
  entryPoints: ['../src/viewer/main.js'],
  minify: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: `${ASSETS}/viewer.js`,
  charset: 'utf8',
  define: { 'process.env.NODE_ENV': '"production"' },
  // Keep the React license in HTML files too, which can be shared on their own.
  banner: { js: '/* React, React DOM and Scheduler\n' + (await readFile('node_modules/react/LICENSE', 'utf8')) + '\n*/' },
  alias: { react: path.resolve('node_modules/react'), 'react-dom': path.resolve('node_modules/react-dom') },
  metafile: true,
})
const viewerBytes = Object.values(viewer.metafile.outputs).reduce((sum, output) => sum + output.bytes, 0)
console.log(`built ${ASSETS}/viewer.js (${Math.round(viewerBytes / 1024)} KB)`)

// The bundled script finds SKILL.md and its assets in its own skill directory, not in the source tree.
const skillAssets = {
  name: 'skill-assets',
  setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/]cli[\\/]assets\.mjs$/ }, async (args) => {
      const contents = (await readFile(args.path, 'utf8')).replace(
        /^export const SKILL_DIR = .*$/m,
        "export const SKILL_DIR = fileURLToPath(new URL('../', import.meta.url))",
      )
      if (!contents.includes("new URL('../', import.meta.url)")) throw new Error('src/cli/assets.mjs: SKILL_DIR declaration not found')
      return { contents, loader: 'js' }
    })
  },
}
await build({
  ...common,
  entryPoints: ['../src/cli/main.mjs'],
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: `${SKILL}/scripts/diagram.mjs`,
  charset: 'utf8',
  plugins: [skillAssets],
})
await chmod(`${SKILL}/scripts/diagram.mjs`, 0o755)
console.log(`built ${SKILL}/scripts/diagram.mjs`)
if (only === 'client') process.exit(0)

// ── icon pack ──────────────────────────────────────────────────────────────
async function iconStamp() {
  const h = createHash('sha256')
  for (const f of ['package-lock.json', 'icons.mjs', '../src/core/iconrules.js']) h.update(await readFile(f))
  return h.digest('hex')
}
await mkdir('generated', { recursive: true })
const stamp = await iconStamp()
let fresh = false
try {
  fresh = (await readFile('generated/icon-stamp', 'utf8')) === stamp && (await readdir(ASSETS)).includes(shardFile(0))
  if (fresh) await readFile('generated/icon-index.json')
} catch {
  fresh = false
}
if (fresh) console.log('icon pack up to date')
else {
  const { index, shards } = await generateIcons({ log: (m) => console.log(m) })
  for (const f of (await readdir(ASSETS)).filter((f) => /^icons-\d+\.js$/.test(f))) await unlink(`${ASSETS}/${f}`)
  for (let i = 0; i < shards.length; i++)
    await writeFile(`${ASSETS}/${shardFile(i)}`, chunk(shardFile(i), `module.exports = ${JSON.stringify(shards[i])};`))
  await writeFile('generated/icon-index.json', JSON.stringify(index))
  await writeFile('generated/icon-stamp', stamp)
  console.log(`built ${ASSETS}/icons-*.js (${shards.length}) and generated/icon-index.json`)
}

// ── engine ─────────────────────────────────────────────────────────────────
// LikeC4 dependencies the engine never runs, replaced by the stubs in ./stubs
// (each says why its module is unused). Removes zod and json5 with them.
const STUBS = {
  '@likec4/config': 'likec4-config.mjs',
  '@likec4/generators/likec4': 'likec4-generators.mjs',
  picomatch: 'picomatch.mjs',
  '@logtape/logtape': 'logtape.mjs',
}
const unusedModules = {
  name: 'unused-modules',
  setup(b) {
    b.onResolve({ filter: /^(@likec4\/config|@likec4\/generators\/likec4|picomatch|@logtape\/logtape)$/ }, (args) => ({
      path: path.resolve('stubs', STUBS[args.path]),
    }))
  },
}
const engine = { ...common, entryPoints: ['../src/engine/entry.mjs'], minify: true, platform: 'browser', plugins: [unusedModules] }
await build({ ...engine, format: 'esm', outfile: `${ASSETS}/engine.mjs` })
const cjs = await build({ ...engine, format: 'cjs', write: false })
await writeFile(`${ASSETS}/engine.js`, chunk('engine.js', cjs.outputFiles[0].text))
const noIndex = {
  name: 'no-icon-index',
  setup(b) {
    b.onResolve({ filter: /generated\/icon-index\.json$/ }, (args) => ({ path: args.path, namespace: 'no-icon-index' }))
    b.onLoad({ filter: /.*/, namespace: 'no-icon-index' }, () => ({ contents: '{"brand":{},"vendor":{},"generic":[]}', loader: 'json' }))
  },
}
const lean = await build({ ...engine, format: 'cjs', write: false, plugins: [unusedModules, noIndex] })
// Same chunk name: the viewer asks for engine.js in both modes.
await writeFile(`${ASSETS}/engine-offline.js`, chunk('engine.js', lean.outputFiles[0].text))
console.log(`built ${ASSETS}/engine.mjs, engine.js and engine-offline.js`)
