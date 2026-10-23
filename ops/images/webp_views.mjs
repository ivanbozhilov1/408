// Source/settings keyed render derivatives. Original PNGs and product photographs stay intact.
// node ops/images/webp_views.mjs ROOT [--quality 0.85] [--chromium EXE] [--dry-run]
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const slash = p => p.split(path.sep).join('/')
export const encoder = quality => ({ name: 'chromium-canvas-webp', version: 1, quality })
export const derivativeKey = (sourceSha256, settings) => sha(JSON.stringify({ sourceSha256, ...settings }))
function files(root, ext) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => e.name.startsWith('.') || e.name === 'ops' ? [] : e.isDirectory() ? files(path.join(root, e.name), ext) : ext.test(e.name) ? [path.join(root, e.name)] : [])
}
function local(root, ref) {
  const file = path.resolve(root, ref)
  if (!file.startsWith(root + path.sep)) throw Error(`unsafe render path: ${ref}`)
  const realRoot = fs.realpathSync(root)
  let existing = file
  while (!fs.existsSync(existing)) existing = path.dirname(existing)
  const real = fs.realpathSync(existing)
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw Error(`unsafe symlink render path: ${ref}`)
  return file
}
export async function convert(root, { quality = 0.85, executablePath, dryRun = false, cacheDir } = {}) {
  root = path.resolve(root)
  if (!(quality > 0 && quality <= 1)) throw Error('quality must be in (0, 1]')
  const started = performance.now(), settings = { ...encoder(quality), chromiumExecutableSha256: sha(fs.readFileSync(executablePath || chromium.executablePath())) }
  const manifestPath = path.join(root, 'render-derivatives.json')
  const prior = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { derivatives: [] }
  const previous = new Map(prior.derivatives.map(d => [d.key + ':' + d.sourcePath, d]))
  const refs = new Map(), products = new Set(), dataPath = path.join(root, 'collection-data.json')
  const data = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, 'utf8')) : null
  const sourceFor = ref => {
    if (typeof ref !== 'string') return null
    const old = prior.derivatives.find(d => d.servedPath === ref)
    if (old && fs.existsSync(local(root, old.sourcePath))) return old.sourcePath
    const png = ref.replace(/\.webp$/i, '.png')
    return /\.png$/i.test(png) && fs.existsSync(local(root, png)) ? png : null
  }
  const add = ref => { const source = sourceFor(ref); if (source) refs.set(ref, source) }
  for (const d of data?.designs || []) {
    for (const p of d.products || []) if (p.image) products.add(p.image)
    for (const item of [d, ...(d.renderHistory || [])]) { add(item.hero); for (const v of item.views || []) add(v.image) }
  }
  // Infer only explicitly named legacy renders, never supplier boards, plans or product PNGs.
  const html = files(root, /\.html$/i)
  for (const f of html) for (const match of fs.readFileSync(f, 'utf8').matchAll(/(?:src|href)=["']([^"'?#]+\.png)["']/gi)) {
    if (/(?:^|[\/_-])(?:render|photoreal)(?:[\/_-]|\.)/i.test(match[1])) add(slash(path.relative(root, path.resolve(path.dirname(f), match[1]))))
  }
  for (const [ref, source] of refs) if (products.has(ref) || products.has(source)) throw Error(`render also used as product photo: ${ref}`)
  let browser, page, encoded = 0, reused = 0
  const derivatives = [], replacements = new Map()
  try {
    for (const [ref, sourcePath] of refs) {
      const source = fs.readFileSync(local(root, sourcePath)), sourceSha256 = sha(source)
      const key = derivativeKey(sourceSha256, settings)
      const servedPath = `${sourcePath.replace(/\.png$/i, '')}.${key.slice(0, 24)}.webp`
      let record = previous.get(key + ':' + sourcePath)
      const cacheFile = cacheDir && path.join(cacheDir, key + '.webp'), cacheMeta = cacheDir && path.join(cacheDir, key + '.json')
      if (!record && cacheMeta && fs.existsSync(cacheMeta) && fs.existsSync(cacheFile)) {
        const cached = JSON.parse(fs.readFileSync(cacheMeta, 'utf8'))
        if (cached.key === key && cached.sourceSha256 === sourceSha256 && sha(fs.readFileSync(cacheFile)) === cached.servedSha256) {
          record = { ...cached, sourcePath, servedPath }
          if (!dryRun) fs.copyFileSync(cacheFile, local(root, servedPath))
        }
      }
      const valid = record?.servedPath === servedPath && fs.existsSync(local(root, servedPath)) && sha(fs.readFileSync(local(root, servedPath))) === record.servedSha256
      if (valid) reused++
      else if (!dryRun) {
        if (!browser) { browser = await chromium.launch(executablePath ? { executablePath } : {}); page = await browser.newPage() }
        const image = await page.evaluate(async ([b64, q]) => {
          const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
          c.getContext('2d').drawImage(img, 0, 0)
          const blob = await new Promise(resolve => c.toBlob(resolve, 'image/webp', q))
          if (!blob || blob.type !== 'image/webp') throw Error('WebP encoding unavailable')
          const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''
          for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          return { b64: btoa(s), width: c.width, height: c.height }
        }, [source.toString('base64'), quality])
        const bytes = Buffer.from(image.b64, 'base64')
        fs.writeFileSync(local(root, servedPath), bytes)
        record = { key, sourcePath, sourceSha256, servedPath, servedSha256: sha(bytes), width: image.width, height: image.height, bytes: bytes.length, encoder: settings }
        if (cacheDir) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cacheFile, bytes); fs.writeFileSync(cacheMeta, JSON.stringify(record)) }
        encoded++
      }
      if (record) derivatives.push(record)
      replacements.set(ref, servedPath); replacements.set(sourcePath, servedPath)
    }
  } finally { await browser?.close() }
  if (!dryRun) {
    if (data) {
      for (const d of data.designs) for (const item of [d, ...(d.renderHistory || [])]) {
        if (replacements.has(item.hero)) item.hero = replacements.get(item.hero)
        for (const v of item.views || []) {
          const replacement = replacements.get(v.image)
          if (!replacement) continue
          const record = derivatives.find(x => x.servedPath === replacement)
          v.image = replacement; delete v.sha256
          v.sourceImage = record.sourcePath; v.sourceSha256 = record.sourceSha256
          v.servedSha256 = record.servedSha256; v.width = record.width; v.height = record.height
        }
      }
      fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n')
    }
    for (const f of html) {
      let text = fs.readFileSync(f, 'utf8')
      const fileReplacements = new Map()
      for (const [from, to] of replacements) {
        const relFrom = slash(path.relative(path.dirname(f), local(root, from))), relTo = slash(path.relative(path.dirname(f), local(root, to)))
        fileReplacements.set(relFrom, relTo)
      }
      text = text.replace(/<[a-z][^>]*>/gi, tag => tag.replace(/\b(src|href)=(["'])([^"']+)\2/gi, (whole, attr, quote, ref) => {
        if (attr.toLowerCase() === 'href' && /\b(?:download|data-original)(?:\s|=|>)/i.test(tag)) return whole
        return fileReplacements.has(ref) ? `${attr}=${quote}${fileReplacements.get(ref)}${quote}` : whole
      }))
      fs.writeFileSync(f, text)
    }
    const unique = [...new Map(derivatives.map(d => [d.servedPath, d])).values()]
    fs.writeFileSync(manifestPath, JSON.stringify({ schema: 1, derivatives: unique }, null, 2) + '\n')
  }
  return { schema: 1, referenced: refs.size, encoded, reused, seconds: (performance.now() - started) / 1000, dryRun }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1]
  console.log(JSON.stringify(await convert(args[0] || '.', { quality: args.includes('--quality') ? Number(value('--quality')) : 0.85, executablePath: args.includes('--chromium') ? value('--chromium') : process.env.UNIT408_CHROMIUM, cacheDir: args.includes('--cache-dir') ? value('--cache-dir') : undefined, dryRun: args.includes('--dry-run') })))
}
