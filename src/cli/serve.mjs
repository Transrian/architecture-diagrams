// Local-only by default; every request is mapped through an explicit allowlist.
import http from 'node:http'
import { stat, readFile, readdir, lstat } from 'node:fs/promises'
import path from 'node:path'
import { bySnapshotIndex } from '../core/shared.js'
import { ASSETS } from './assets.mjs'
import { buildHtml, snapshotName, readAsset } from './html.mjs'
import { locations, verdict } from './verdict.mjs'

export async function serve(file, { port = 0, host = '127.0.0.1', lang = null, log = console.log } = {}) {
  const { absolute, historyDir } = locations(file)
  const name = path.basename(file, path.extname(file))
  const html = await buildHtml({ mode: 'remote', name, lang })
  await readAsset(ASSETS, 'engine.js')
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(host)
  if (!loopback) console.error('Warning: this server is reachable beyond loopback; diagrams may contain private hostnames.')
  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json; charset=utf-8', cache = 'no-store') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    if (req.method !== 'GET') return send(405, { error: 'Method not allowed' })
    try {
      // Loopback binding alone does not stop DNS rebinding from a hostile site.
      // Wider binds are an explicit user choice and may use a custom hostname.
      if (loopback) {
        let hostname
        try { hostname = new URL('http://' + req.headers.host).hostname } catch {}
        if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return send(403, { error: 'Loopback host required' })
      }
      const route = new URL(req.url, 'http://localhost').pathname
      if (route === '/') return send(200, html, 'text/html; charset=utf-8')
      if (route === '/engine.js' || /^\/icons-\d{3}\.js$/.test(route)) {
        const src = await readFile(path.join(ASSETS, route.slice(1)), 'utf8')
        return send(200, src, 'text/javascript; charset=utf-8', 'public, max-age=3600')
      }
      if (route === '/api/source') {
        const info = await stat(absolute)
        if (!info.isFile()) return send(404, { error: 'Not found' })
        return send(200, { text: await readFile(absolute, 'utf8'), version: `${info.mtimeMs}:${info.size}` })
      }
      if (route === '/api/history') {
        let entries = []
        try { entries = await readdir(historyDir, { withFileTypes: true }) } catch (e) { if (e.code !== 'ENOENT') throw e }
        return send(200, { names: entries.filter((e) => e.isFile() && snapshotName.test(e.name)).map((e) => e.name).sort(bySnapshotIndex) })
      }
      const snapshot = /^\/api\/history\/([^/]+)$/.exec(route)?.[1]
      if (snapshot && snapshotName.test(snapshot)) {
        const real = path.join(historyDir, snapshot)
        // Snapshots must be regular files, not symlinks out of the allowlist.
        if (!(await lstat(real)).isFile()) return send(404, { error: 'Not found' })
        return send(200, { text: await readFile(real, 'utf8') })
      }
      return send(404, { error: 'Not found' })
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return send(404, { error: 'Not found' })
      return send(500, { error: 'Cannot read diagram data' })
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.removeListener('error', reject); resolve() })
  })
  let last
  let busy = false
  async function tick() {
    if (busy) return
    busy = true
    try {
      const info = await stat(absolute).catch(() => null)
      const stamp = info ? `${info.mtimeMs}:${info.size}` : 'absent'
      if (stamp !== last) {
        last = stamp
        log((await verdict(file, { history: true })).text)
      }
    } catch (error) { console.error(error.message) } finally { busy = false }
  }
  const timer = setInterval(tick, 1000)
  server.once('close', () => clearInterval(timer))
  const address = server.address()
  const urlHost = host.includes(':') ? `[${host}]` : host
  const url = `http://${urlHost}:${address.port}/`
  log(`Serving ${name} at ${url}`)
  void tick()
  return { server, url }
}
