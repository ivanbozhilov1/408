import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { convertAssets } from './webp_assets.mjs'

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const executablePath = process.env.UNIT408_CHROMIUM || chromium.executablePath()
const tempRoot = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
const draw = async (page, kind, type, quality = 0.95) => Buffer.from(await page.evaluate(([kind, type, quality]) => {
  const c = document.createElement('canvas'); c.width = kind === 'plan' ? 640 : 320; c.height = kind === 'plan' ? 400 : 200; const g = c.getContext('2d')
  if (kind === 'photo') {
    // Smooth gradients with mild grain, like a render: no dominant flat colours.
    const d = g.createImageData(320, 200); let seed = 7
    for (let i = 0; i < d.data.length; i += 4) {
      const p = i / 4, x = p % 320, y = Math.floor(p / 320); seed = (seed * 1103515245 + 12345) & 0x7fffffff
      d.data[i] = 90 + x / 3 + (seed % 9); d.data[i + 1] = 60 + y / 2 + (seed % 7); d.data[i + 2] = 40 + (x + y) / 5 + (seed % 5); d.data[i + 3] = 255
    }
    g.putImageData(d, 0, 0)
  } else if (kind.startsWith('product')) {
    // A grainy object on a white ground: most pixels are one flat colour.
    g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 200); const d = g.createImageData(110, 90); let seed = kind.length
    for (let i = 0; i < d.data.length; i += 4) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d.data[i] = 120 + (seed % 40); d.data[i + 1] = 80 + (seed % 30); d.data[i + 2] = 50 + (seed % 20); d.data[i + 3] = 255 }
    g.putImageData(d, 100, 55)
  } else {
    // A plan sheet: four line-art panels on white, flat and big enough that lossless WebP saves well over 10%
    // (about 36% with Chrome 156; lossy q0.85 would be larger than the PNG).
    g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 400); g.strokeStyle = '#000'; g.lineWidth = 2; g.fillStyle = '#000'; g.font = '11px sans-serif'
    for (const [x, y] of [[0, 0], [320, 0], [0, 200], [320, 200]]) {
      for (let i = 0; i < 12; i++) g.strokeRect(x + 10 + i * 9, y + 10 + i * 5, 150, 90)
      g.fillText('Bedroom 3200 x 2800', x + 170, y + 150)
    }
  }
  return c.toDataURL(type, quality).split(',')[1]
}, [kind, type, quality]), 'base64')

test('page and JSON rasters become WebP; downloads, provenance, prose and sources stay original', async () => {
  const root = tempRoot('webp-assets-test-')
  const browser = await chromium.launch({ executablePath })
  try {
    const page = await browser.newPage()
    const photo = await draw(page, 'photo', 'image/png'), plan = await draw(page, 'plan', 'image/png'), jpg = await draw(page, 'photo', 'image/jpeg'), cheap = await draw(page, 'photo', 'image/jpeg', 0.3)
    // Supplier product photos often look flat (white ground, palette PNG) but are still photographs.
    const rug = await draw(page, 'product-rug', 'image/png'), cutout = await draw(page, 'product-cutout', 'image/png')
    fs.mkdirSync(path.join(root, 'set/assets'), { recursive: true })
    fs.writeFileSync(path.join(root, 'set/assets/view.png'), photo); fs.writeFileSync(path.join(root, 'set/assets/plan.png'), plan)
    fs.writeFileSync(path.join(root, 'product.jpg'), jpg); fs.writeFileSync(path.join(root, 'cheap.jpg'), cheap)
    fs.mkdirSync(path.join(root, 'set/assets/products')); fs.writeFileSync(path.join(root, 'set/assets/products/rug.png'), rug); fs.writeFileSync(path.join(root, 'cutout.png'), cutout)
    fs.writeFileSync(path.join(root, 'set/index.html'), [
      '<meta property="og:image" content="assets/view.png">',
      '<a href="assets/view.png" target="_blank"><img src="assets/view.png?v=1" alt=""></a>',
      '<img srcset="/408/set/assets/view.png 2x, ../product.jpg 1x"><button data-full="assets/view.png">zoom</button>',
      '<a href="assets/view.png" download>Download original</a><img data-original="assets/view.png" alt=""><img src="../cheap.jpg">',
      '<img src="assets/plan.png"><img src="assets/products/rug.png"><script>const literal = "assets/view.png"</script>'
    ].join('\n'))
    fs.writeFileSync(path.join(root, 'collection-data.json'), JSON.stringify({ designs: [{ hero: 'set/assets/view.png', label: 'set/assets/view.png', sourceImage: 'set/assets/view.png', views: [{ file: 'set/assets/view.png', sha256: sha(photo) }], products: [{ image: 'product.jpg' }, { image: 'cutout.png' }] }] }, null, 2) + '\n')
    const first = await convertAssets(root, { executablePath, cacheDir: path.join(root, '.cache') })
    assert.equal(first.referenced, 6); assert.equal(first.encoded, 6)
    const html = fs.readFileSync(path.join(root, 'set/index.html'), 'utf8'), data = JSON.parse(fs.readFileSync(path.join(root, 'collection-data.json'), 'utf8'))
    const view = html.match(/<img src="(assets\/view\.[a-f0-9]{24}\.webp)\?v=1"/)?.[1]
    assert.ok(view, 'img src rewritten with query kept')
    assert.match(html, new RegExp(`<a href="${view}" target="_blank">`))
    assert.match(html, new RegExp(`srcset="/408/set/${view} 2x, \\.\\./product\\.[a-f0-9]{24}\\.webp 1x"`))
    assert.match(html, new RegExp(`data-full="${view}"`))
    assert.match(html, /content="assets\/view\.png"/, 'meta content untouched')
    assert.match(html, /<a href="assets\/view\.png" download>/, 'download keeps the original')
    assert.match(html, /<img data-original="assets\/view\.png" alt="">/, 'data-original tag untouched')
    assert.match(html, /const literal = "assets\/view\.png"/, 'inline script text untouched')
    assert.match(html, /<img src="\.\.\/cheap\.jpg">/, 'a WebP that does not save 10% is not used')
    const design = data.designs[0]
    assert.equal(design.hero, 'set/' + view); assert.equal(design.label, 'set/assets/view.png'); assert.equal(design.sourceImage, 'set/assets/view.png')
    assert.equal(design.views[0].file, 'set/' + view); assert.equal(design.views[0].sha256, undefined)
    assert.equal(design.views[0].sourceSha256, sha(photo)); assert.equal(design.views[0].servedSha256, sha(fs.readFileSync(path.join(root, 'set', view))))
    assert.match(design.products[0].image, /^product\.[a-f0-9]{24}\.webp$/)
    assert.deepEqual(fs.readFileSync(path.join(root, 'set/assets/view.png')), photo, 'source bytes untouched')
    const records = JSON.parse(fs.readFileSync(path.join(root, 'render-derivatives.json'), 'utf8')).derivatives
    const viewRecord = records.find(r => r.sourcePath === 'set/assets/view.png')
    assert.equal(viewRecord.lossless, false); assert.equal(viewRecord.width, 320); assert.equal(viewRecord.height, 200)
    // The key covers the launched browser and this encoder's code, not just the file at the executable path.
    assert.equal(viewRecord.encoder.browserVersion, browser.version())
    assert.equal(viewRecord.encoder.encoderSourceSha256, sha(fs.readFileSync(new URL('./webp_assets.mjs', import.meta.url))))
    assert.equal(records.some(r => r.sourcePath === 'cheap.jpg'), false)
    for (const product of ['set/assets/products/rug.png', 'cutout.png']) assert.equal(records.find(r => r.sourcePath === product)?.lossless, false, product + ' is a lossy photo')
    assert.match(html, /<img src="assets\/products\/rug\.[a-f0-9]{24}\.webp">/)
    // The flat plan sheet always qualifies: it is the one lossless conversion, and opaque, so it decodes pixel-identical.
    const planRecord = records.find(r => r.sourcePath === 'set/assets/plan.png')
    assert.equal(planRecord?.lossless, true, 'plan converted losslessly'); assert.equal(first.lossless, 1)
    assert.ok(planRecord.bytes <= plan.length * 0.9, 'lossless plan saves at least 10%')
    assert.match(html, /<img src="assets\/plan\.[a-f0-9]{24}\.webp">/)
    const same = await page.evaluate(async ([a, b]) => {
      const pixels = async src => { const i = new Image(); i.src = src; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, c.width, c.height).data }
      const x = await pixels('data:image/png;base64,' + a), y = await pixels('data:image/webp;base64,' + b)
      return x.length === y.length && x.every((v, i) => v === y[i])
    }, [plan.toString('base64'), fs.readFileSync(path.join(root, 'set', planRecord.servedPath.slice(4))).toString('base64')])
    assert.ok(same, 'lossless plan decodes pixel-identical')
    // Same bytes on a fresh copy reuse the cache, including kept-original decisions.
    fs.writeFileSync(path.join(root, 'collection-data.json'), JSON.stringify({ designs: [{ hero: 'set/assets/view.png' }] }))
    const second = await convertAssets(root, { executablePath, cacheDir: path.join(root, '.cache') })
    assert.equal(second.encoded, 0); assert.ok(second.reused >= 2); assert.equal(second.reused, second.referenced)
  } finally { await browser.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('rasters outside the scratch root are never read', async () => {
  const base = tempRoot('webp-assets-boundary-')
  const root = path.join(base, 'site'); fs.mkdirSync(root)
  fs.writeFileSync(path.join(base, 'outside.png'), 'private sentinel')
  fs.writeFileSync(path.join(root, 'index.html'), '<img src="../outside.png"><img src="/outside.png">')
  try {
    const result = await convertAssets(root, { executablePath: process.env.UNIT408_CHROMIUM || chromium.executablePath() })
    assert.equal(result.referenced, 0)
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), '<img src="../outside.png"><img src="/outside.png">')
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})

test('an HTML page saved as a .jpg fails the run with an error that names the file', async () => {
  const root = tempRoot('webp-assets-bad-image-')
  try {
    fs.mkdirSync(path.join(root, 'jkl/assets/products'), { recursive: true })
    fs.writeFileSync(path.join(root, 'jkl/assets/products/K-CONSOLE.jpg'), '<!doctype html><title>404 Not Found</title><h1>Not Found</h1>')
    fs.writeFileSync(path.join(root, 'jkl/index.html'), '<img src="assets/products/K-CONSOLE.jpg">')
    await assert.rejects(convertAssets(root, { executablePath }), error => {
      assert.match(error.message, /^jkl\/assets\/products\/K-CONSOLE\.jpg: /); assert.ok(error.cause, 'decoder error kept as cause'); return true
    })
    assert.equal(fs.readFileSync(path.join(root, 'jkl/index.html'), 'utf8'), '<img src="assets/products/K-CONSOLE.jpg">')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('a public JSON file containing NaN fails the run with an error that names the file', async () => {
  const root = tempRoot('webp-assets-bad-json-')
  try {
    fs.mkdirSync(path.join(root, 'astra/measured'), { recursive: true })
    fs.writeFileSync(path.join(root, 'index.html'), '<a href="astra/measured/dimensions.json">dimensions</a>')
    fs.writeFileSync(path.join(root, 'astra/measured/dimensions.json'), '{"width": NaN}\n')
    await assert.rejects(convertAssets(root, { executablePath }), { message: /^astra\/measured\/dimensions\.json: / })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('a torn cache meta is a cache miss: the image is encoded again and the entry rewritten', async () => {
  const base = tempRoot('webp-assets-cache-'), cacheDir = path.join(base, 'cache')
  const browser = await chromium.launch({ executablePath })
  try {
    const photo = await draw(await browser.newPage(), 'photo', 'image/png')
    const site = name => { const root = path.join(base, name); fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'index.html'), '<img src="view.png">'); fs.writeFileSync(path.join(root, 'view.png'), photo); return root }
    const served = root => fs.readFileSync(path.join(root, fs.readdirSync(root).find(f => f.endsWith('.webp'))))
    const first = await convertAssets(site('first'), { executablePath, cacheDir })
    assert.equal(first.encoded, 1); assert.equal(first.converted, 1)
    const metas = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json')); assert.equal(metas.length, 1)
    const metaPath = path.join(cacheDir, metas[0]), whole = fs.readFileSync(metaPath, 'utf8')
    fs.writeFileSync(metaPath, whole.slice(0, Math.floor(whole.length / 2)))
    const second = await convertAssets(site('second'), { executablePath, cacheDir })
    assert.equal(second.encoded, 1); assert.equal(second.reused, 0)
    assert.equal(fs.readFileSync(metaPath, 'utf8'), whole, 'meta rewritten in full')
    assert.deepEqual(fs.readdirSync(cacheDir).filter(f => f.endsWith('.tmp')), [], 'no temporary cache files left')
    assert.deepEqual(served(path.join(base, 'second')), served(path.join(base, 'first')))
    const third = await convertAssets(site('third'), { executablePath, cacheDir })
    assert.equal(third.encoded, 0); assert.equal(third.reused, 1)
  } finally { await browser.close(); fs.rmSync(base, { recursive: true, force: true }) }
})

test('the CLI refuses a missing ROOT and a repository checkout, and runs on a scratch tree', () => {
  const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('./webp_assets.mjs', import.meta.url)), ...args], { encoding: 'utf8' })
  const missing = cli('--quality', '0.9', '--cache-dir', os.tmpdir())
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /ROOT is required/)
  for (const marker of ['.git', 'ops/release/public_artifact.py']) {
    const root = tempRoot('webp-assets-checkout-')
    try {
      fs.mkdirSync(path.dirname(path.join(root, marker)), { recursive: true }); fs.writeFileSync(path.join(root, marker), 'checkout marker')
      fs.writeFileSync(path.join(root, 'index.html'), '<img src="a.png">'); fs.writeFileSync(path.join(root, 'a.png'), 'not an image')
      // With no browser at this path, a run that got past the guard would fail with a different message.
      const refused = cli(root, '--chromium', path.join(root, 'no-browser'))
      assert.notEqual(refused.status, 0); assert.ok(refused.stderr.includes(`it holds ${marker}`), refused.stderr)
      assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), '<img src="a.png">')
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  }
  const scratch = tempRoot('webp-assets-scratch-')
  try {
    fs.writeFileSync(path.join(scratch, 'index.html'), '<p>No images.</p>')
    const ran = cli(scratch, '--chromium', executablePath)
    assert.equal(ran.status, 0, ran.stderr); assert.equal(JSON.parse(ran.stdout).referenced, 0)
  } finally { fs.rmSync(scratch, { recursive: true, force: true }) }
})
