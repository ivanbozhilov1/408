// Site-wide raster derivatives for the public build scratch tree. Never run it on the repository working tree.
// Every PNG/JPEG that a page shows through an HTML src/href/srcset/poster/data-* attribute or a public JSON value
// gets a WebP sibling when that is clearly smaller: JPEGs, product photos and photographic PNGs lossy; other flat or
// transparent PNGs (plans, boards, model views with captions) lossless.
// Download links (<a download>, data-original) and JSON provenance keys keep pointing at the original.
// node ops/images/webp_assets.mjs ROOT [--quality 0.85] [--chromium EXE] [--cache-dir DIR]
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const slash = p => p.split(path.sep).join('/')
const RASTER = /\.(?:png|jpe?g)$/i
// JSON keys public_artifact.py never treats as links (provenance and prose).
const NOT_LINKS = new Set(['sourceImage', 'sourcePath', 'label', 'name', 'caption', 'description', 'summary', 'note', 'notes'])
const SKIP_JSON = new Set(['render-derivatives.json', 'public-manifest.json'])
// Share of pixels in the 16 most frequent colours. Plans, boards, diagrams and text sit on flat fills; renders and photos do not.
export const FLAT_SHARE = 0.3
// Keep the original unless the WebP saves at least this share of its bytes.
export const MIN_SAVING = 0.1
export const assetEncoder = quality => ({ name: 'chromium-canvas-webp-asset', version: 2, quality, flatShare: FLAT_SHARE, minSaving: MIN_SAVING })
// Cache entries are hints: a missing, unreadable or torn entry is a miss, re-encoded and overwritten.
const readCache = (file, parse) => { try { const bytes = fs.readFileSync(file); return parse ? JSON.parse(bytes.toString('utf8')) : bytes } catch { return null } }
// Write beside the target, then rename over it, so an interrupted run cannot leave a torn cache entry.
const writeAtomic = (file, data) => { fs.writeFileSync(file + '.tmp', data); fs.renameSync(file + '.tmp', file) }

function files(root, ext) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => e.name.startsWith('.') || e.name === 'ops' || e.name === 'node_modules' ? [] : e.isDirectory() ? files(path.join(root, e.name), ext) : ext.test(e.name) ? [path.join(root, e.name)] : [])
}
// Same resolution rules as public_artifact.resolve: relative to the referencing file, or under the /408/ site root.
function target(root, from, ref) {
  if (typeof ref !== 'string' || !ref || ref.includes('${') || /^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(ref)) return null
  const pathPart = ref.split(/[?#]/)[0]
  if (!RASTER.test(pathPart)) return null
  let value
  try { value = decodeURIComponent(pathPart) } catch { return null }
  if (value.includes('\\') || value.includes('\0')) return null
  const file = value.startsWith('/408/') ? path.resolve(root, value.slice(5)) : value.startsWith('/') ? path.resolve(root, value.slice(1)) : path.resolve(path.dirname(from), value)
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.lstatSync(file).isFile()) return null
  const real = fs.realpathSync(file)
  return real.startsWith(fs.realpathSync(root) + path.sep) ? file : null
}
// Replace only the extension so query strings, fragments, /408/ prefixes and percent-encoding survive.
const served = (ref, key) => ref.replace(/\.(?:png|jpe?g)(?=$|[?#])/i, `.${key.slice(0, 24)}.webp`)
const servedFile = (file, key) => file.replace(RASTER, `.${key.slice(0, 24)}.webp`)

function htmlRefs(text, each) {
  // Rewrites attribute values inside tags only; inline script text and <meta content> stay untouched.
  return text.replace(/<[a-z][^>]*>/gi, tag => {
    if (/\s(?:download|data-original)(?:[\s=>]|\/?>|$)/i.test(tag)) return tag
    return tag.replace(/(\s)(src|href|srcset|poster|data-[\w-]+)=(["'])([^"']*)\3/gi, (whole, space, attr, quote, value) => {
      const next = attr.toLowerCase() === 'srcset'
        ? value.split(',').map(part => part.replace(/^(\s*)(\S+)/, (m, lead, url) => lead + each(url))).join(',')
        : each(value)
      return next === value ? whole : `${space}${attr}=${quote}${next}${quote}`
    })
  })
}
// inProducts: the value sits under a "products" key, i.e. it is a supplier product photo.
function jsonRefs(value, each, key = '', inProducts = false) {
  if (Array.isArray(value)) return value.map(v => jsonRefs(v, each, key, inProducts))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = jsonRefs(v, each, k, inProducts || k === 'products')
    // An object whose sha256 bound the original now records the source and served hashes separately.
    for (const [k, v] of Object.entries(value)) {
      const change = typeof v === 'string' && out[k] !== v && each.changes?.get(v)
      if (change && out.sha256 === change.sourceSha256) { delete out.sha256; out.sourceSha256 = change.sourceSha256; out.servedSha256 = change.servedSha256 }
    }
    return out
  }
  return typeof value === 'string' && !NOT_LINKS.has(key) ? each(value, inProducts) : value
}

async function encode(page, source, mime, photo, quality) {
  return page.evaluate(async ([b64, mime, photo, quality, flatShare]) => {
    const img = new Image(); img.src = `data:${mime};base64,` + b64; await img.decode()
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data, counts = new Map()
    let alpha = false
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 255) alpha = true
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; counts.set(k, (counts.get(k) || 0) + 1)
    }
    const top = [...counts.values()].sort((a, b) => b - a).slice(0, 16).reduce((a, b) => a + b, 0) / (d.length / 4)
    // JPEGs and supplier product photos are photographs (product PNGs are often palette-reduced or on white, so they
    // look flat). Any other PNG that is flat or transparent (plans, boards, model views with captions) stays lossless.
    const lossless = mime === 'image/png' && !photo && (alpha || top >= flatShare)
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/webp', lossless ? 1 : quality))
    if (!blob || blob.type !== 'image/webp') throw Error('WebP encoding unavailable')
    const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { b64: btoa(s), width: c.width, height: c.height, lossless, flatShare: Math.round(top * 1000) / 1000 }
  }, [source.toString('base64'), mime, photo, quality, FLAT_SHARE])
}

export async function convertAssets(root, { quality = 0.85, executablePath, cacheDir } = {}) {
  root = path.resolve(root)
  if (!(quality > 0 && quality < 1)) throw Error('quality must be in (0, 1)')
  const started = performance.now(), rel = file => slash(path.relative(root, file))
  const settings = { ...assetEncoder(quality), chromiumExecutableSha256: sha(fs.readFileSync(executablePath || chromium.executablePath())) }
  const html = files(root, /\.html$/i), json = files(root, /\.json$/i).filter(f => !SKIP_JSON.has(path.basename(f)))
  const parsed = new Map(json.map(f => {
    try { return [f, JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))] } catch (error) { throw Error(`${rel(f)}: ${error.message}`, { cause: error }) }
  }))
  const sources = new Map() // file -> product photo?
  const collect = from => (ref, inProducts = false) => {
    const file = target(root, from, ref)
    if (file) sources.set(file, sources.get(file) || inProducts || /(?:^|\/)products\//.test(slash(path.relative(root, path.dirname(file))) + '/'))
    return ref
  }
  for (const f of html) htmlRefs(fs.readFileSync(f, 'utf8'), collect(f))
  for (const [f, data] of parsed) jsonRefs(data, collect(f))
  const records = new Map(), stats = { referenced: sources.size, converted: 0, keptOriginal: 0, encoded: 0, reused: 0, lossless: 0, sourceBytes: 0, servedBytes: 0 }
  let browser, page
  try {
    for (const [file, photo] of [...sources].sort()) {
      try {
        const source = fs.readFileSync(file), sourceSha256 = sha(source)
        const key = sha(JSON.stringify({ sourceSha256, photo, ...settings }))
        const cacheFile = cacheDir && path.join(cacheDir, key + '.webp'), cacheMeta = cacheDir && path.join(cacheDir, key + '.json')
        let result = null
        const hit = cacheMeta && readCache(cacheMeta, true)
        if (hit?.key === key && hit.sourceSha256 === sourceSha256) {
          const bytes = hit.keep ? null : readCache(cacheFile)
          if (hit.keep || (bytes && sha(bytes) === hit.servedSha256)) { result = { ...hit, bytes }; stats.reused++ }
        }
        if (!result) {
          if (!browser) { browser = await chromium.launch(executablePath ? { executablePath } : {}); page = await browser.newPage() }
          const image = await encode(page, source, /\.png$/i.test(file) ? 'image/png' : 'image/jpeg', photo, quality)
          const bytes = Buffer.from(image.b64, 'base64')
          const keep = bytes.length > source.length * (1 - MIN_SAVING)
          result = { key, sourceSha256, keep, servedSha256: keep ? null : sha(bytes), width: image.width, height: image.height, lossless: image.lossless, flatShare: image.flatShare, bytes: keep ? null : bytes }
          if (cacheDir) {
            fs.mkdirSync(cacheDir, { recursive: true })
            if (!keep) writeAtomic(cacheFile, bytes)
            const { bytes: _, ...meta } = result; writeAtomic(cacheMeta, JSON.stringify(meta))
          }
          stats.encoded++
        }
        stats.sourceBytes += source.length
        if (result.keep) { stats.keptOriginal++; stats.servedBytes += source.length; continue }
        const out = servedFile(file, key)
        fs.writeFileSync(out, result.bytes)
        stats.converted++; stats.servedBytes += result.bytes.length; if (result.lossless) stats.lossless++
        records.set(file, { key, sourcePath: rel(file), sourceSha256, servedPath: rel(out), servedSha256: result.servedSha256, width: result.width, height: result.height, bytes: result.bytes.length, lossless: result.lossless, encoder: settings })
      } catch (error) { throw Error(`${rel(file)}: ${error?.message ?? error}`, { cause: error }) }
    }
  } finally { await browser?.close() }
  const rewrite = from => {
    const each = ref => {
      const record = records.get(target(root, from, ref))
      if (!record) return ref
      each.changes.set(ref, record); return served(ref, record.key)
    }
    each.changes = new Map()
    return each
  }
  for (const f of html) {
    const text = fs.readFileSync(f, 'utf8'), next = htmlRefs(text, rewrite(f))
    if (next !== text) fs.writeFileSync(f, next)
  }
  for (const [f, data] of parsed) {
    const each = rewrite(f), next = jsonRefs(data, each)
    if (each.changes.size) {
      const text = fs.readFileSync(f, 'utf8'), indent = text.match(/^[\[{]\r?\n([ \t]+)/)?.[1]
      fs.writeFileSync(f, JSON.stringify(next, null, indent) + (text.endsWith('\n') ? '\n' : ''))
    }
  }
  const manifestPath = path.join(root, 'render-derivatives.json')
  const prior = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { schema: 1, derivatives: [] }
  const known = new Set(prior.derivatives.map(d => d.servedPath))
  prior.derivatives.push(...[...records.values()].filter(r => !known.has(r.servedPath)))
  if (records.size) fs.writeFileSync(manifestPath, JSON.stringify({ schema: 1, derivatives: prior.derivatives }, null, 2) + '\n')
  return { schema: 1, ...stats, seconds: (performance.now() - started) / 1000 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1]
  console.log(JSON.stringify(await convertAssets(args[0] || '.', { quality: args.includes('--quality') ? Number(value('--quality')) : 0.85, executablePath: args.includes('--chromium') ? value('--chromium') : process.env.UNIT408_CHROMIUM, cacheDir: args.includes('--cache-dir') ? value('--cache-dir') : undefined })))
}
