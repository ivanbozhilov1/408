import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { convertAssets, kindOf, VIEW_QUALITY, PHOTO_MAX_EDGE } from './webp_assets.mjs'

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
// A w x h grainy gradient whose top `flat` share of rows is plain white (a caption band or wall), so a flat model view
// passes the old colour cut yet still compresses well lossy.
const drawSized = async (page, w, h, type, flat = 0) => Buffer.from(await page.evaluate(([w, h, type, flat]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), d = g.createImageData(w, h); let seed = 11
  for (let i = 0; i < d.data.length; i += 4) {
    const p = i / 4, x = p % w, y = Math.floor(p / w); seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const white = y < h * flat
    d.data[i] = white ? 255 : 90 + x * 96 / w + (seed % 9); d.data[i + 1] = white ? 255 : 60 + y * 100 / h + (seed % 7); d.data[i + 2] = white ? 255 : 40 + (x + y) * 64 / (w + h) + (seed % 5); d.data[i + 3] = 255
  }
  g.putImageData(d, 0, 0); return c.toDataURL(type, 0.95).split(',')[1]
}, [w, h, type, flat]), 'base64')

test('the approved option-2 settings are pinned: views and boards at 0.9, photos capped at 1600 px', () => {
  assert.equal(VIEW_QUALITY, 0.9); assert.equal(PHOTO_MAX_EDGE, 1600)
})

test('kindOf: plans first, then product photos, boards and model views; renders and measured views are other', () => {
  for (const [file, kind] of [
    ['assets/PLAN-D.png', 'plan'], ['rooms/dining-plan.png', 'plan'], ['hal/assets/scale/HA-hal_quarter-scale.jpg', 'plan'],
    ['hal/assets/scale/HA-dimensioned-elevation.png', 'plan'],
    ['hop/assets/HD-room-hal_main.png', 'model-view'], ['queen-oct23/assets/QE-room-entry.png', 'model-view'], ['astra/photo-room/A-opposite.png', 'model-view'],
    // The root D/E/F elevations are flat boards of scaled supplier photos, not 3D views.
    ['assets/D-main.png', 'board'], ['assets/D-opposite.png', 'board'], ['assets/D-products.png', 'board'],
    ['assets/products/D-BED.jpg', 'photo'], ['assets/products/D-PLANT.jpg', 'photo'], ['queen-oct23/assets/products/Q1-E-PLANTER.png', 'photo'],
    ['assets/D-render-entry.png', 'other'], ['assets/D-render-main.png', 'other'], ['astra/renders/A-main.png', 'other'], ['astra/original/A-opposite.png', 'other'], ['rooms/living-photo-j054.jpg', 'other'],
    // Kept at today's encoding (Ivan, 29 Oct): the measured astra views and the queen selection-matrix photo grids.
    ['astra/measured/A-main.png', 'other'], ['queen-oct23/assets/Q1-selection-matrix.jpg', 'other']
  ]) assert.equal(kindOf(file), kind, file)
  assert.equal(kindOf('collection-assets/0069a4fc692a76e824027e6d.png', true), 'photo', 'JSON "products" key')
  assert.equal(kindOf('assets/PLAN-D.png', true), 'plan', 'a plan stays a plan under "products"')
})

test('model views are lossy at VIEW_QUALITY, plans keep the colour cut, product photos are capped at PHOTO_MAX_EDGE', async () => {
  const root = tempRoot('webp-assets-kinds-')
  const browser = await chromium.launch({ executablePath })
  try {
    const page = await browser.newPage(), put = (file, bytes) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), bytes); return bytes }
    put('assets/D-room-entry.png', await drawSized(page, 320, 200, 'image/png', 0.6)); const plan = put('assets/PLAN-D.png', await draw(page, 'plan', 'image/png'))
    put('assets/products/D-BED.jpg', await drawSized(page, 2400, 1200, 'image/jpeg')); put('assets/products/D-RUG.jpg', await drawSized(page, 1200, 800, 'image/jpeg'))
    put('assets/products/D-SOFA.webp', await drawSized(page, 2000, 1000, 'image/webp'))
    const small = put('assets/products/D-LAMP.webp', await drawSized(page, 1000, 500, 'image/webp')), view = put('assets/D-old.webp', await drawSized(page, 2000, 1000, 'image/webp'))
    const rendered = put('assets/products/D-render.0123456789abcdef01234567.webp', await drawSized(page, 2000, 1000, 'image/webp'))
    put('render-derivatives.json', JSON.stringify({ schema: 1, derivatives: [{ sourcePath: 'assets/products/D-render.png', servedPath: 'assets/products/D-render.0123456789abcdef01234567.webp' }] }))
    const refs = ['D-room-entry.png', 'PLAN-D.png', 'products/D-BED.jpg', 'products/D-RUG.jpg', 'products/D-SOFA.webp', 'products/D-LAMP.webp', 'D-old.webp', 'products/D-render.0123456789abcdef01234567.webp'].map(f => `<img src="assets/${f}">`).join('\n')
    put('index.html', refs)
    const result = await convertAssets(root, { executablePath })
    assert.equal(result.referenced, 6, 'the non-product WebP and the render-pass WebP are not sources'); assert.equal(result.resized, 2)
    assert.equal(result.skipped, 1, 'D-LAMP.webp is within the cap'); assert.equal(result.converted + result.keptOriginal + result.skipped, result.referenced)
    assert.equal(result.encoded + result.reused, result.referenced)
    const records = new Map(JSON.parse(fs.readFileSync(path.join(root, 'render-derivatives.json'), 'utf8')).derivatives.map(r => [r.sourcePath, r]))
    const room = records.get('assets/D-room-entry.png')
    assert.equal(room?.kind, 'model-view'); assert.equal(room.lossless, false, 'a flat model view is lossy'); assert.equal(room.quality, 0.9)
    const planRecord = records.get('assets/PLAN-D.png')
    assert.equal(planRecord?.kind, 'plan'); assert.equal(planRecord.lossless, true, 'a flat plan stays lossless'); assert.equal(planRecord.quality, undefined); assert.ok(planRecord.bytes <= plan.length * 0.9)
    const bed = records.get('assets/products/D-BED.jpg')
    assert.equal(bed?.kind, 'photo'); assert.deepEqual([bed.width, bed.height], [PHOTO_MAX_EDGE, 800]); assert.deepEqual(bed.resizedFrom, [2400, 1200]); assert.equal(bed.quality, 0.85)
    const rug = records.get('assets/products/D-RUG.jpg')
    assert.deepEqual([rug?.width, rug?.height], [1200, 800]); assert.equal(rug.resizedFrom, undefined, 'within the cap: not resized')
    const sofa = records.get('assets/products/D-SOFA.webp')
    assert.deepEqual([sofa?.width, sofa?.height], [1600, 800]); assert.deepEqual(sofa.resizedFrom, [2000, 1000])
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    assert.ok(html.includes(`<img src="${sofa.servedPath}">`) && !html.includes('D-SOFA.webp"'), 'capped WebP ref rewritten')
    assert.equal(sofa.servedPath, `assets/products/D-SOFA.${sofa.servedSha256.slice(0, 24)}.webp`)
    // Decoded dimensions match the record, as readback checks them.
    const decoded = await page.evaluate(async b64 => { const i = new Image(); i.src = 'data:image/webp;base64,' + b64; await i.decode(); return [i.naturalWidth, i.naturalHeight] }, fs.readFileSync(path.join(root, sofa.servedPath)).toString('base64'))
    assert.deepEqual(decoded, [1600, 800])
    for (const [file, bytes] of [['assets/products/D-LAMP.webp', small], ['assets/D-old.webp', view], ['assets/products/D-render.0123456789abcdef01234567.webp', rendered]]) {
      assert.equal(records.has(file), false, file + ' has no record'); assert.ok(html.includes(`<img src="${file}">`), file + ' ref unchanged'); assert.deepEqual(fs.readFileSync(path.join(root, file)), bytes)
    }
  } finally { await browser.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

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
    // Names come from the served bytes, not that key, so a browser or encoder change that keeps the bytes keeps the URL.
    for (const r of records) assert.equal(r.servedPath.match(/\.([a-f0-9]{24})\.webp$/)?.[1], r.servedSha256.slice(0, 24), r.servedPath)
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

test('boards at 0.9, portrait and JSON-only photos capped, big non-photos untouched, in-cap AVIF skipped', async () => {
  const root = tempRoot('webp-assets-cases-')
  const browser = await chromium.launch({ executablePath })
  try {
    const page = await browser.newPage(), put = (file, bytes) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), bytes); return bytes }
    put('assets/D-products.png', await drawSized(page, 320, 200, 'image/png', 0.6))
    put('assets/products/D-TALL.jpg', await drawSized(page, 1200, 2400, 'image/jpeg'))
    put('assets/D-room-big.png', await drawSized(page, 2400, 1200, 'image/png'))
    put('collection-assets/D-ARMCHAIR.webp', await drawSized(page, 2000, 1000, 'image/webp'))
    // WebP bytes behind an .avif name: Chrome sniffs the content, so it decodes, and within the cap it is skipped.
    const avif = put('assets/products/D-CHAIR.avif', await drawSized(page, 1000, 500, 'image/webp'))
    put('index.html', ['D-products.png', 'products/D-TALL.jpg', 'D-room-big.png', 'products/D-CHAIR.avif'].map(f => `<img src="assets/${f}">`).join('\n'))
    put('data.json', JSON.stringify({ products: [{ image: 'collection-assets/D-ARMCHAIR.webp' }] }))
    const result = await convertAssets(root, { executablePath })
    const records = new Map(JSON.parse(fs.readFileSync(path.join(root, 'render-derivatives.json'), 'utf8')).derivatives.map(r => [r.sourcePath, r]))
    const board = records.get('assets/D-products.png')
    assert.equal(board?.kind, 'board'); assert.equal(board.lossless, false, 'a flat board is lossy'); assert.equal(board.quality, 0.9)
    const tall = records.get('assets/products/D-TALL.jpg')
    assert.deepEqual([tall?.width, tall?.height], [800, 1600]); assert.deepEqual(tall.resizedFrom, [1200, 2400])
    const big = records.get('assets/D-room-big.png')
    assert.equal(big?.kind, 'model-view'); assert.deepEqual([big.width, big.height], [2400, 1200]); assert.equal(big.resizedFrom, undefined, 'only photos are capped')
    const chair = records.get('collection-assets/D-ARMCHAIR.webp')
    assert.equal(chair?.kind, 'photo'); assert.deepEqual([chair.width, chair.height], [1600, 800]); assert.deepEqual(chair.resizedFrom, [2000, 1000])
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8')).products[0].image, chair.servedPath, 'JSON ref rewritten')
    assert.equal(records.has('assets/products/D-CHAIR.avif'), false, 'in-cap AVIF has no record')
    assert.ok(fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('<img src="assets/products/D-CHAIR.avif">'), 'AVIF ref unchanged')
    assert.deepEqual(fs.readFileSync(path.join(root, 'assets/products/D-CHAIR.avif')), avif)
    assert.equal(result.referenced, 5); assert.equal(result.skipped, 1); assert.equal(result.converted, 4); assert.equal(result.keptOriginal, 0)
    assert.equal(result.converted + result.keptOriginal + result.skipped, result.referenced); assert.equal(result.encoded + result.reused, result.referenced)
  } finally { await browser.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('the cache key carries the file type: in-cap WebP bytes saved as .jpg are still converted', async () => {
  const base = tempRoot('webp-assets-ext-'), cacheDir = path.join(base, 'cache')
  const browser = await chromium.launch({ executablePath })
  try {
    const page = await browser.newPage(), bytes = await drawSized(page, 1000, 500, 'image/webp')
    const run = async name => {
      const root = path.join(base, name); fs.mkdirSync(path.join(root, 'products'), { recursive: true })
      fs.writeFileSync(path.join(root, 'products', name), bytes); fs.writeFileSync(path.join(root, 'index.html'), `<img src="products/${name}">`)
      return [root, await convertAssets(root, { executablePath, cacheDir })]
    }
    const [, webp] = await run('B.webp')
    assert.equal(webp.skipped, 1); assert.equal(webp.converted, 0)
    // A reused skip still counts as skipped.
    const [, again] = await run('A.webp')
    assert.equal(again.reused, 1); assert.equal(again.skipped, 1); assert.equal(again.keptOriginal, 0)
    const [root, jpg] = await run('Z.jpg')
    assert.equal(jpg.reused, 0, 'no cache entry shared with the .webp'); assert.equal(jpg.converted, 1); assert.equal(jpg.skipped, 0)
    assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /<img src="products\/Z\.[a-f0-9]{24}\.webp">/)
  } finally { await browser.close(); fs.rmSync(base, { recursive: true, force: true }) }
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

test('a torn cache meta is a cache miss and a cache write that fails is skipped: the image is encoded again', async () => {
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
    // Cache writes are best effort: an entry that cannot be replaced (here a directory in its place) costs a re-encode, not the run.
    fs.rmSync(metaPath); fs.mkdirSync(metaPath)
    const fourth = await convertAssets(site('fourth'), { executablePath, cacheDir })
    assert.equal(fourth.encoded, 1); assert.equal(fourth.converted, 1)
    assert.deepEqual(served(path.join(base, 'fourth')), served(path.join(base, 'first')))
    assert.deepEqual(fs.readdirSync(cacheDir).filter(f => f.endsWith('.tmp')), [], 'failed cache write leaves no temporary file')
  } finally { await browser.close(); fs.rmSync(base, { recursive: true, force: true }) }
})

test('the CLI refuses a missing ROOT, a repository checkout and any folder inside one, and runs on a scratch tree', () => {
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
  // `node ops/images/webp_assets.mjs queen-oct23` from a checkout: a set folder, or a folder below it, is refused too.
  const checkout = tempRoot('webp-assets-checkout-')
  try {
    fs.mkdirSync(path.join(checkout, 'ops/release'), { recursive: true }); fs.writeFileSync(path.join(checkout, 'ops/release/public_artifact.py'), 'checkout marker')
    for (const sub of ['queen-oct23', 'tmp/scratch']) {
      const root = path.join(checkout, sub); fs.mkdirSync(root, { recursive: true })
      fs.writeFileSync(path.join(root, 'index.html'), '<img src="a.png">'); fs.writeFileSync(path.join(root, 'a.png'), 'not an image')
      const refused = cli(root, '--chromium', path.join(checkout, 'no-browser'))
      assert.notEqual(refused.status, 0); assert.ok(refused.stderr.includes(`it is inside ${checkout}, which holds ops/release/public_artifact.py`), refused.stderr)
      assert.deepEqual(fs.readdirSync(root).sort(), ['a.png', 'index.html']); assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), '<img src="a.png">')
    }
  } finally { fs.rmSync(checkout, { recursive: true, force: true }) }
  const scratch = tempRoot('webp-assets-scratch-')
  try {
    fs.writeFileSync(path.join(scratch, 'index.html'), '<p>No images.</p>')
    const ran = cli(scratch, '--chromium', executablePath)
    assert.equal(ran.status, 0, ran.stderr); assert.equal(JSON.parse(ran.stdout).referenced, 0)
  } finally { fs.rmSync(scratch, { recursive: true, force: true }) }
})
