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

const shim = `(() => {
  const chunks = new Map();
  window.__DSHD__ = { chunks };
  const req = name => { throw new Error('Standalone chunks cannot require ' + name); };
  window.__ModuleLoader__ = { load({chunk, factory}) {
    chunks.set(chunk.replace(/^\\.\\//, ''), factory(req));
  } };
  // In remote mode the client loads /client.likec4.js and /client.icons-NNN.js.
})();`

export function assembleHtml({ mode = 'embedded', name = 'diagram', files = {}, lang = null, icons = {}, bundle, engine = '', generatedAt = new Date().toISOString() } = {}) {
  if (!['embedded', 'remote'].includes(mode)) throw new Error(`Unknown HTML mode: ${mode}`)
  // Publish only a display name, never a source path (POSIX or Windows).
  const data = { v: 1, mode, name: String(name).split(/[\\/]/).pop(), generatedAt, lang }
  if (mode === 'embedded') {
    data.files = files
    data.icons = icons
  }
  return `<!doctype html>
<html lang="${escapeHtml(lang ?? 'en')}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(data.name)}</title>
<script>${escapeScript(shim)}</script>
</head><body><div id="dshd-app"></div>
<script type="application/json" id="dshd-data">${escapeJson(data)}</script>
${mode === 'embedded' ? `<script>${escapeScript(engine)}</script>` : ''}
<script>${escapeScript(bundle)}</script>
</body></html>
`
}
