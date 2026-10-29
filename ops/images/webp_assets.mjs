// Site-wide raster derivatives for the public build scratch tree. Never run it on the repository working tree: it
// rewrites ROOT in place, so it refuses a missing ROOT, a ROOT that holds .git, and a ROOT at or below a directory
// that holds ops/release/public_artifact.py.
// Every PNG/JPEG that a page shows through an HTML src/href/srcset/poster/data-* attribute or a public JSON value
// gets a WebP sibling when that saves at least MIN_SAVING of the source bytes. The encoding follows kindOf(path):
// 3D model views (-room- names, astra photo-room/ views) and boards (*-products.*, the root D/E/F elevations
// assets/D-main.png etc.) lossy at VIEW_QUALITY; supplier product photos lossy at --quality, first downscaled to
// PHOTO_MAX_EDGE on the long edge when larger (product photos that are already WebP/AVIF are re-encoded only for that
// cap, otherwise skipped); plans and every other PNG (renders, the astra/measured/ views) lossless when it has
// transparency or its 16 most common colours cover at least FLAT_SHARE of its pixels, lossy at --quality otherwise;
// other JPEGs (JPEG plans, site photos, the queen selection matrices) lossy at --quality. The measured astra views
// and the queen selection matrices keep this rule at Ivan's request (29 Oct). Lossless is exact for opaque pixels
// only: the canvas premultiplies alpha, so translucent pixels can shift colour.
// Stats: referenced = converted + keptOriginal + skipped and encoded + reused = referenced; skipped counts WebP/AVIF
// product photos within the cap, which are only decoded to read their size.
// Download links (<a download>, data-original) and JSON provenance keys keep pointing at the original.
// node ops/images/webp_assets.mjs ROOT [--quality 0.85] [--chromium EXE] [--cache-dir DIR]
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const slash = p => p.split(path.sep).join('/')
// PNG/JPEG are always sources; WebP/AVIF only as product photos, re-encoded only when over the size cap.
const CAPPED = /\.(?:webp|avif)$/i, SOURCE = /\.(?:png|jpe?g|webp|avif)$/i
// JSON keys public_artifact.py never treats as links (provenance and prose).
const NOT_LINKS = new Set(['sourceImage', 'sourcePath', 'label', 'name', 'caption', 'description', 'summary', 'note', 'notes'])
const SKIP_JSON = new Set(['render-derivatives.json', 'public-manifest.json'])
// Share of pixels in the 16 most frequent colours. Plans, boards, diagrams and text sit on flat fills; renders and photos do not.
export const FLAT_SHARE = 0.3
// Keep the original unless the WebP saves at least this share of its bytes.
export const MIN_SAVING = 0.1
// Model views and boards are lossy at this quality whatever their colour count; product photos are capped at this long edge.
export const VIEW_QUALITY = 0.9
export const PHOTO_MAX_EDGE = 1600
export const assetEncoder = quality => ({ name: 'chromium-canvas-webp-asset', version: 3, quality, viewQuality: VIEW_QUALITY, photoMaxEdge: PHOTO_MAX_EDGE, flatShare: FLAT_SHARE, minSaving: MIN_SAVING })
// Image kind from the site-relative path; inProducts is the JSON "products" key signal. Plans win over every other
// name rule; -PLANT/-PLANTER product photos are not plans. Photos: a "products" key or a products/ folder.
// Boards: *-products.<ext>, and the root D/E/F elevations assets/D-main.png etc., which are flat boards of scaled
// supplier photos with label chips, not 3D views. Model views: -room- names, and the astra Cycles renders of the
// model (photo-room/A-main.png etc.). Everything else is 'other' and keeps the colour-count rule: the -render- files,
// astra/renders/, astra/original/, the 6 dimension-controlled astra/measured/ views (kept as today, Ivan 29 Oct) and
// the queen-oct23 Q*-selection-matrix.jpg photo grids (JPEG, so lossy at --quality as today).
export function kindOf(file, inProducts = false) {
  const name = file.split('/').pop()
  if (/^PLAN-|-plan\.|dimensioned-elevation|hal_[a-z]+-scale\./.test(name)) return 'plan'
  if (inProducts || /(?:^|\/)products\//.test(file)) return 'photo'
  if (/-products\.[a-z]+$/i.test(name) || /^assets\/[A-Z]+-(?:main|opposite)\.[A-Za-z]+$/.test(file)) return 'board'
  if (/-room-/.test(name) || /(?:^|\/)photo-room\/[A-Z]+-(?:main|opposite)\.[A-Za-z]+$/.test(file)) return 'model-view'
  return 'other'
}
// Part of every derivative key, so an edit to this encoder re-encodes instead of reusing older cached bytes.
const ENCODER_SOURCE_SHA256 = sha(fs.readFileSync(new URL(import.meta.url)))

// ROOT must be public_artifact.py's scratch copy: a checkout, or any folder inside one (a set folder such as
// queen-oct23), would have its tracked HTML/JSON rewritten in place. An ancestor .git proves nothing: scratch
// builds may sit in another repository's ignored tmp/, so only this repository's own marker is looked for above ROOT.
export function scratchRoot(root) {
  if (!root) throw Error('ROOT is required: pass the scratch build directory, never the repository')
  const resolved = path.resolve(root), marker = 'ops/release/public_artifact.py'
  if (fs.existsSync(path.join(resolved, '.git'))) throw Error(`refusing to rewrite ${resolved}: it holds .git, so it is a repository checkout, not a scratch build`)
  for (let dir = resolved; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, marker))) throw Error(`refusing to rewrite ${resolved}: ${dir === resolved ? 'it holds' : `it is inside ${dir}, which holds`} ${marker}, so it is a repository checkout, not a scratch build`)
    if (path.dirname(dir) === dir) return resolved
  }
}
// Cache entries are hints: a missing, unreadable or torn entry is a miss, re-encoded and overwritten.
const readCache = (file, parse) => { try { const bytes = fs.readFileSync(file); return parse ? JSON.parse(bytes.toString('utf8')) : bytes } catch { return null } }
// Write beside the target under a name no other process uses, then rename over it, so an interrupted run cannot
// leave a torn entry and two builds sharing the cache cannot take each other's temporary file. Best effort: a write
// that fails (Windows refuses a rename over a file another build has open; a full disk) only costs a re-encode later.
const writeAtomic = (file, data) => {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, file) } catch { try { fs.rmSync(tmp, { force: true }) } catch {} }
}

function files(root, ext) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => e.name.startsWith('.') || e.name === 'ops' || e.name === 'node_modules' ? [] : e.isDirectory() ? files(path.join(root, e.name), ext) : ext.test(e.name) ? [path.join(root, e.name)] : [])
}
// Same resolution rules as public_artifact.resolve: relative to the referencing file, or under the /408/ site root.
function target(root, from, ref) {
  if (typeof ref !== 'string' || !ref || ref.includes('${') || /^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(ref)) return null
  const pathPart = ref.split(/[?#]/)[0]
  if (!SOURCE.test(pathPart)) return null
  let value
  try { value = decodeURIComponent(pathPart) } catch { return null }
  if (value.includes('\\') || value.includes('\0')) return null
  const file = value.startsWith('/408/') ? path.resolve(root, value.slice(5)) : value.startsWith('/') ? path.resolve(root, value.slice(1)) : path.resolve(path.dirname(from), value)
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.lstatSync(file).isFile()) return null
  const real = fs.realpathSync(file)
  return real.startsWith(fs.realpathSync(root) + path.sep) ? file : null
}
// Replace only the extension so query strings, fragments, /408/ prefixes and percent-encoding survive. A WebP is named
// after its own bytes (first 24 hex digits of servedSha256), not the cache key, so a new Chrome version or an encoder
// edit that re-encodes to the same bytes keeps every URL; only changed bytes get a new name.
const served = (ref, servedSha256) => ref.replace(/\.(?:png|jpe?g|webp|avif)(?=$|[?#])/i, `.${servedSha256.slice(0, 24)}.webp`)
const servedFile = (file, servedSha256) => file.replace(SOURCE, `.${servedSha256.slice(0, 24)}.webp`)

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

// capOnly: an existing WebP/AVIF product photo, encoded only when it needs the long-edge cap; otherwise { skip }.
async function encode(page, source, mime, kind, quality, capOnly) {
  return page.evaluate(async ([b64, mime, kind, quality, viewQuality, maxEdge, flatShare, capOnly]) => {
    const img = new Image(); img.src = `data:${mime};base64,` + b64; await img.decode()
    const w = img.naturalWidth, h = img.naturalHeight, scale = kind === 'photo' ? Math.min(1, maxEdge / Math.max(w, h)) : 1
    if (capOnly && scale === 1) return { skip: true, width: w, height: h }
    const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale)
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height)
    const d = g.getImageData(0, 0, c.width, c.height).data, counts = new Map()
    let alpha = false
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 255) alpha = true
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; counts.set(k, (counts.get(k) || 0) + 1)
    }
    const top = [...counts.values()].sort((a, b) => b - a).slice(0, 16).reduce((a, b) => a + b, 0) / (d.length / 4)
    // JPEGs and supplier product photos are photographs (product PNGs are often palette-reduced or on white, so they
    // look flat). Model views and boards are lossy at viewQuality: their captions and flat walls put them on both
    // sides of the colour cut. Any other PNG (plans, line art) is lossless when it has transparency or top >= flatShare.
    const view = kind === 'model-view' || kind === 'board'
    const lossless = mime === 'image/png' && kind !== 'photo' && !view && (alpha || top >= flatShare)
    const q = lossless ? 1 : view ? viewQuality : quality
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/webp', q))
    if (!blob || blob.type !== 'image/webp') throw Error('WebP encoding unavailable')
    const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { b64: btoa(s), width: c.width, height: c.height, lossless, quality: lossless ? undefined : q, resizedFrom: scale < 1 ? [w, h] : undefined, flatShare: Math.round(top * 1000) / 1000 }
  }, [source.toString('base64'), mime, kind, quality, VIEW_QUALITY, PHOTO_MAX_EDGE, FLAT_SHARE, capOnly])
}

export async function convertAssets(root, { quality = 0.85, executablePath, cacheDir } = {}) {
  root = scratchRoot(root)
  if (!(quality > 0 && quality < 1)) throw Error('quality must be in (0, 1)')
  const started = performance.now(), rel = file => slash(path.relative(root, file))
  const html = files(root, /\.html$/i), json = files(root, /\.json$/i).filter(f => !SKIP_JSON.has(path.basename(f)))
  const parsed = new Map(json.map(f => {
    try { return [f, JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))] } catch (error) { throw Error(`${rel(f)}: ${error.message}`, { cause: error }) }
  }))
  // WebPs the render pass already wrote are never sources again; nor is any WebP/AVIF that is not a product photo.
  const manifestPath = path.join(root, 'render-derivatives.json')
  const prior = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { schema: 1, derivatives: [] }
  const rendered = new Set(prior.derivatives.map(d => path.resolve(root, d.servedPath)))
  const sources = new Map() // file -> JSON "products" signal
  const collect = from => (ref, inProducts = false) => {
    const file = target(root, from, ref)
    if (!file || rendered.has(file)) return ref
    const known = sources.get(file) || inProducts
    if (!CAPPED.test(file) || kindOf(rel(file), known) === 'photo') sources.set(file, known)
    return ref
  }
  for (const f of html) htmlRefs(fs.readFileSync(f, 'utf8'), collect(f))
  for (const [f, data] of parsed) jsonRefs(data, collect(f))
  const records = new Map(), stats = { referenced: sources.size, converted: 0, keptOriginal: 0, skipped: 0, encoded: 0, reused: 0, lossless: 0, resized: 0, sourceBytes: 0, servedBytes: 0 }
  let browser, page, settings
  try {
    if (sources.size) {
      browser = await chromium.launch(executablePath ? { executablePath } : {}); page = await browser.newPage()
      // The file at the executable path can be a launcher script (CI's google-chrome is a 1 KB wrapper), so the key
      // also carries the launched browser's version and this encoder's own source hash.
      settings = { ...assetEncoder(quality), chromiumExecutableSha256: sha(fs.readFileSync(executablePath || chromium.executablePath())), browserVersion: browser.version(), encoderSourceSha256: ENCODER_SOURCE_SHA256 }
    }
    for (const [file, inProducts] of [...sources].sort()) {
      try {
        const source = fs.readFileSync(file), sourceSha256 = sha(source), kind = kindOf(rel(file), inProducts)
        // The extension decides both the decode mime and capOnly, so it is part of the key: the same bytes saved as
        // .webp and as .jpg are different jobs.
        const ext = path.extname(file).slice(1).toLowerCase(), mime = `image/${{ png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', avif: 'avif' }[ext]}`
        const key = sha(JSON.stringify({ sourceSha256, kind, ext, ...settings }))
        const cacheFile = cacheDir && path.join(cacheDir, key + '.webp'), cacheMeta = cacheDir && path.join(cacheDir, key + '.json')
        let result = null
        const hit = cacheMeta && readCache(cacheMeta, true)
        if (hit?.key === key && hit.sourceSha256 === sourceSha256) {
          const bytes = hit.keep ? null : readCache(cacheFile)
          if (hit.keep || (bytes && sha(bytes) === hit.servedSha256)) { result = { ...hit, bytes }; stats.reused++ }
        }
        if (!result) {
          const image = await encode(page, source, mime, kind, quality, CAPPED.test(file))
          // A WebP/AVIF within the cap is left as it is (only decoded to read its size); it counts as skipped.
          const skip = !!image.skip, bytes = skip ? null : Buffer.from(image.b64, 'base64')
          const keep = !bytes || bytes.length > source.length * (1 - MIN_SAVING)
          result = { key, sourceSha256, keep, skip, servedSha256: keep ? null : sha(bytes), width: image.width, height: image.height, kind, lossless: !!image.lossless, quality: image.quality, resizedFrom: image.resizedFrom, flatShare: image.flatShare, bytes: keep ? null : bytes }
          if (cacheDir) {
            fs.mkdirSync(cacheDir, { recursive: true })
            if (!keep) writeAtomic(cacheFile, bytes)
            const { bytes: _, ...meta } = result; writeAtomic(cacheMeta, JSON.stringify(meta))
          }
          stats.encoded++
        }
        stats.sourceBytes += source.length
        if (result.keep) { stats[result.skip ? 'skipped' : 'keptOriginal']++; stats.servedBytes += source.length; continue }
        const out = servedFile(file, result.servedSha256)
        fs.writeFileSync(out, result.bytes)
        stats.converted++; stats.servedBytes += result.bytes.length; if (result.lossless) stats.lossless++; if (result.resizedFrom) stats.resized++
        // width/height are the served dimensions; readback compares them with the decoded WebP.
        records.set(file, { key, sourcePath: rel(file), sourceSha256, servedPath: rel(out), servedSha256: result.servedSha256, width: result.width, height: result.height, bytes: result.bytes.length, kind, lossless: result.lossless, ...(result.lossless ? {} : { quality: result.quality }), ...(result.resizedFrom ? { resizedFrom: result.resizedFrom } : {}), encoder: settings })
      } catch (error) { throw Error(`${rel(file)}: ${error?.message ?? error}`, { cause: error }) }
    }
  } finally { await browser?.close() }
  const rewrite = from => {
    const each = ref => {
      const record = records.get(target(root, from, ref))
      if (!record) return ref
      each.changes.set(ref, record); return served(ref, record.servedSha256)
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
  const known = new Set(prior.derivatives.map(d => d.servedPath))
  prior.derivatives.push(...[...records.values()].filter(r => !known.has(r.servedPath)))
  if (records.size) fs.writeFileSync(manifestPath, JSON.stringify({ schema: 1, derivatives: prior.derivatives }, null, 2) + '\n')
  return { schema: 1, ...stats, seconds: (performance.now() - started) / 1000 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1]
  // ROOT is the first argument that is neither a flag nor a flag's value. There is no default.
  const root = args.find((arg, i) => !arg.startsWith('--') && !['--quality', '--chromium', '--cache-dir'].includes(args[i - 1]))
  try {
    console.log(JSON.stringify(await convertAssets(root, { quality: args.includes('--quality') ? Number(value('--quality')) : 0.85, executablePath: args.includes('--chromium') ? value('--chromium') : process.env.UNIT408_CHROMIUM, cacheDir: args.includes('--cache-dir') ? value('--cache-dir') : undefined })))
  } catch (error) {
    console.error(`webp_assets: ${error?.message ?? error}`); process.exitCode = 1
  }
}
