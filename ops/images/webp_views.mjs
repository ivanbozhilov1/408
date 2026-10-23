// Re-encode the gallery's PNG renders (design hero, views[].image, renderHistory heroes and views) as WebP next to the
// PNG and point collection-data.json at the WebP. PNGs stay in place; product photos are left alone. Idempotent.
//   node ops/images/webp_views.mjs <repo root> [--quality 0.85] [--chromium <chrome or headless-shell exe>] [--dry-run]
// Needs the playwright package (run from a checkout that has it in node_modules, or set NODE_PATH).
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const argv = process.argv.slice(2)
const flag = (name, dflt) => { const i = argv.indexOf(name); return i < 0 ? dflt : argv[i + 1] }
const root = path.resolve(argv.filter((a, i) => !a.startsWith('--') && !['--quality', '--chromium'].includes(argv[i - 1]))[0] || '.')
const quality = Number(flag('--quality', '0.85'))
const dryRun = argv.includes('--dry-run')
const dataPath = path.join(root, 'collection-data.json')
const text = fs.readFileSync(dataPath, 'utf8')
const data = JSON.parse(text)

const refs = new Set()
const add = p => { if (typeof p === 'string' && /\.png$/i.test(p)) refs.add(p) }
const addViews = views => (views || []).forEach(v => add(v.image))
for (const d of data.designs) {
  add(d.hero)
  addViews(d.views)
  for (const h of d.renderHistory || []) { add(h.hero); addViews(h.views) }
}
const productImages = new Set(data.designs.flatMap(d => (d.products || []).map(p => p.image)))
const shared = [...refs].filter(r => productImages.has(r))
if (shared.length) throw new Error(`also used as product images, would be rewritten there too: ${shared.join(', ')}`)

const todo = [...refs].filter(r => !fs.existsSync(path.join(root, r.replace(/\.png$/i, '.webp'))))
console.log(`${refs.size} PNG renders referenced, ${todo.length} to encode at quality ${quality}${dryRun ? ' (dry run)' : ''}`)
let pngBytes = 0, webpBytes = 0
if (todo.length && !dryRun) {
  const browser = await chromium.launch(flag('--chromium') ? { executablePath: flag('--chromium') } : {})
  const page = await browser.newPage()
  for (const r of todo) {
    const png = fs.readFileSync(path.join(root, r))
    const b64 = await page.evaluate(async ([src, q]) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + src
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth; c.height = img.naturalHeight
      c.getContext('2d').drawImage(img, 0, 0)
      const blob = await new Promise(res => c.toBlob(res, 'image/webp', q))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(s)
    }, [png.toString('base64'), quality])
    const webp = Buffer.from(b64, 'base64')
    if (webp.subarray(0, 4).toString() !== 'RIFF' || webp.subarray(8, 12).toString() !== 'WEBP') throw new Error(`not a WebP: ${r}`)
    fs.writeFileSync(path.join(root, r.replace(/\.png$/i, '.webp')), webp)
    pngBytes += png.length; webpBytes += webp.length
  }
  await browser.close()
  console.log(`encoded ${todo.length}: ${(pngBytes / 1e6).toFixed(1)} MB PNG -> ${(webpBytes / 1e6).toFixed(1)} MB WebP`)
}

// textual swap keeps the file's formatting and line endings byte for byte
let out = text, swapped = 0
for (const r of refs) {
  const webp = r.replace(/\.png$/i, '.webp')
  if (!dryRun && !fs.existsSync(path.join(root, webp))) throw new Error(`missing ${webp}`)
  const needle = JSON.stringify(r)
  swapped += out.split(needle).length - 1
  out = out.split(needle).join(JSON.stringify(webp))
}
if (!dryRun && out !== text) fs.writeFileSync(dataPath, out)
console.log(`${swapped} references now point at WebP${dryRun ? ' (dry run, nothing written)' : ''}`)
