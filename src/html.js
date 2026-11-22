// Pure HTML assembly shared by the CLI and the browser export. No Node or DSH APIs.
export const CURRENT = '.diagram/diagram.c4'
export const HISTORY = '.diagram/diagram'

export const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
export const escapeScript = (text) => String(text)
  .replace(/<\/script/gi, (match) => match.replace('</', '<\\/'))
  .replace(/<!--/g, '<\\!--')
  // React includes an opening script tag in a string. Escape its first letter
  // too, preserving string/regex/identifier semantics and unambiguous tag counts.
  .replace(/<script/gi, (match) => '<\\u' + match.charCodeAt(1).toString(16).padStart(4, '0') + match.slice(2))
export const escapeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

/** The viewer and engine travel gzip + base64 (cli/pack.mjs, build.mjs): about half the bytes. */
export const PACKED_TYPE = 'application/x-dshd-gzip-base64'
const PACKED = /^[A-Za-z0-9+/]*={0,2}$/

// Inflates the packed assets with the browser's own DecompressionStream (no
// network, no decoder shipped), then runs them as inline scripts.
const shim = `(() => {
  const chunks = new Map();
  const req = name => { throw new Error('Standalone chunks cannot require ' + name); };
  window.__ModuleLoader__ = { load({chunk, factory}) {
    chunks.set(chunk.replace(/^\\.\\//, ''), factory(req));
  } };
  const unpack = async (id) => {
    const node = document.getElementById(id);
    if (!node) return null;
    const bytes = Uint8Array.from(atob(node.textContent.trim()), c => c.charCodeAt(0));
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  };
  const run = code => {
    const script = document.createElement('script');
    script.textContent = code;
    document.head.appendChild(script);
    script.remove();
  };
  const fail = error => {
    const app = document.getElementById('dshd-app');
    if (app) app.textContent = 'This diagram cannot open in this browser: ' + (error && error.message || error);
    console.error(error);
  };
  let engine;
  // Embedded mode only; in remote mode the client loads /client.likec4.js and /client.icons-NNN.js.
  const loadEngine = () => engine ??= unpack('dshd-engine').then(code => { if (code !== null) run(code); });
  window.__DSHD__ = { chunks, engine: loadEngine };
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof DecompressionStream !== 'function') return fail(new Error('DecompressionStream is missing (Chrome 80, Firefox 113, Safari 16.4 or later)'));
    loadEngine().catch(() => {});
    unpack('dshd-viewer').then(run).catch(fail);
  });
})();`

export function assembleHtml({ mode = 'embedded', name = 'diagram', files = {}, lang = null, icons = {}, iconIndex = null, bundle = '', engine = '', generatedAt = new Date().toISOString() } = {}) {
  if (!['embedded', 'remote'].includes(mode)) throw new Error(`Unknown HTML mode: ${mode}`)
  // Base64 cannot close a script element; anything else is a caller bug.
  if (!PACKED.test(bundle) || !PACKED.test(engine)) throw new Error('HTML assets must be packed (gzip + base64)')
  // Publish only a display name, never a source path (POSIX or Windows).
  const data = { v: 1, mode, name: String(name).split(/[\\/]/).pop(), generatedAt, lang }
  if (mode === 'embedded') {
    data.files = files
    data.icons = icons
    // The engine of offline pages has no index of its own: these entries resolve the same icons.
    data.iconIndex = iconIndex
  }
  return `<!doctype html>
<html lang="${escapeHtml(lang ?? 'en')}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(data.name)}</title>
<script>${escapeScript(shim)}</script>
</head><body><div id="dshd-app"></div>
<!-- The viewer (React license included) and the LikeC4/Graphviz engine below are gzip + base64. -->

<script type="application/json" id="dshd-data">${escapeJson(data)}</script>
${mode === 'embedded' ? `<script type="${PACKED_TYPE}" id="dshd-engine">${engine}</script>` : ''}
<script type="${PACKED_TYPE}" id="dshd-viewer">${bundle}</script>
</body></html>
`
}
