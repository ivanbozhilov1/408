// GET-only independent byte hashes plus browser-decoded render dimensions and public workflow.
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import http from 'node:http'
import { chromium } from 'playwright'
const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1]
const manifestFile = value('--manifest'), manifestBytes = fs.readFileSync(manifestFile)
let server
if (args.includes('--serve-dir')) {
  const directory = path.resolve(value('--serve-dir'))
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const file = path.resolve(directory, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''))
    if (req.method !== 'GET' || !file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
}
const manifest = JSON.parse(manifestBytes), base = new URL(server ? `http://127.0.0.1:${server.address().port}/` : value('--base-url').replace(/\/?$/, '/'))
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.hash || base.search) throw Error('plain public/local HTTP base URL required, without credentials/query/fragment')
function safeUrl(ref, query = false) {
  let decoded = ref
  for (let i = 0; i < 4; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next }
  if (!decoded || /[\\%:#]/.test(decoded) || decoded.startsWith('/') || decoded.split(/[/?]/).includes('..') || decoded.includes('//') || (!query && decoded.includes('?'))) throw Error('unsafe readback asset path')
  const url = new URL(ref, base)
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw Error('unsafe readback origin/path')
  return url
}
function allowedRequest(raw) {
  const url = new URL(raw)
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return false
  try { const decoded = decodeURIComponent(url.pathname); return !decoded.includes('\\') && !decoded.split('/').includes('..') && !decoded.includes('%') } catch { return false }
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex'), started = performance.now()
const browser = await chromium.launch(args.includes('--chromium') ? { executablePath: value('--chromium') } : {})
try {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*', async route => {
    if (!['GET', 'HEAD'].includes(route.request().method()) || !allowedRequest(route.request().url())) return route.abort()
    // Browser redirects can bypass a second route interception. Static artifacts never need them.
    try {
      const response = await route.fetch({ maxRedirects: 0 })
      if (response.status() >= 300 && response.status() < 400) return route.abort()
      return route.fulfill({ response })
    } catch { return route.abort() }
  })
  const get = async ref => {
    const url = safeUrl(ref)
    const response = await context.request.get(url.href, { maxRedirects: 0 })
    if (response.status() !== 200) throw Error(`readback HTTP ${response.status()}: ${ref}`)
    return response.body()
  }
  if (sha(await get('public-manifest.json')) !== sha(manifestBytes)) throw Error('served release public manifest differs')
  let next = 0, verifiedBytes = 0
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < manifest.files.length) {
      const file = manifest.files[next++], bytes = await get(file.path)
      if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw Error(`served asset hash/size differs: ${file.path}`)
      verifiedBytes += bytes.length
    }
  }))
  const page = await context.newPage(), dimensions = []
  await page.goto(base.href, { waitUntil: 'domcontentloaded' })
  const derivativeEntry = manifest.files.find(f => f.path === 'render-derivatives.json')
  if (derivativeEntry) {
    const data = JSON.parse((await get(derivativeEntry.path)).toString())
    for (const record of data.derivatives) {
      const result = await page.evaluate(async url => {
        const response = await fetch(url, { cache: 'no-store' }); if (!response.ok) throw Error('image HTTP failure')
        const bytes = await response.arrayBuffer(), digest = await crypto.subtle.digest('SHA-256', bytes)
        const blob = new Blob([bytes], { type: 'image/webp' }), image = await createImageBitmap(blob)
        return { width: image.width, height: image.height, sha256: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('') }
      }, safeUrl(record.servedPath).href)
      if (result.width !== record.width || result.height !== record.height || result.sha256 !== record.servedSha256) throw Error(`browser served render differs: ${record.servedPath}`)
      dimensions.push({ path: record.servedPath, ...result })
    }
  }
  const routes = ['index.html', 'archive.html', 'fable-def.html', 'astra-human-views.html'].filter(p => manifest.files.some(f => f.path === p))
  for (const route of routes) {
    const response = await page.goto(safeUrl(route + '?test=1', true).href, { waitUntil: 'domcontentloaded' })
    if (response.status() !== 200) throw Error(`browser route failed: ${route}`)
    if (route === 'index.html' && manifest.files.some(f => f.path === 'collection.js')) {
      await page.waitForFunction(() => document.querySelectorAll('[data-design], .design-card, .design-tab, #design-select option').length > 0 || document.querySelector('h2')?.textContent, { timeout: 15000 })
      const buttons = page.locator('button[data-view]')
      if (await buttons.count() > 1) await buttons.nth(1).click()
      await page.waitForFunction(() => [...document.images].some(img => img.complete && img.naturalWidth > 0))
    }
  }
  console.log(JSON.stringify({ schema: 1, status: 'INDEPENDENT_READBACK_ACCEPTED', files: manifest.files.length, verifiedBytes, renderedImages: dimensions.length, dimensions, browserRoutes: routes, readbackSeconds: (performance.now()-started)/1000 }))
} finally { await browser.close(); if (server) await new Promise(resolve => server.close(resolve)) }
