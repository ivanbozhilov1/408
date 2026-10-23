import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { convert } from './webp_views.mjs'

test('source/settings keyed cache refreshes same-path PNG, reuses unchanged bytes and preserves product photos/original downloads', async () => {
  const root = fs.mkdtempSync(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../'), 'webp-test-'))
  const executablePath = process.env.UNIT408_CHROMIUM || chromium.executablePath()
  const browser = await chromium.launch({ executablePath })
  try {
    const page = await browser.newPage()
    const png = async color => Buffer.from(await page.evaluate(color => { const c = document.createElement('canvas'); c.width = 3; c.height = 2; const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 3, 2); return c.toDataURL('image/png').split(',')[1] }, color), 'base64')
    const original = await png('red'), replacement = await png('blue')
    fs.writeFileSync(path.join(root, 'view.png'), original); fs.writeFileSync(path.join(root, 'product.png'), original)
    fs.writeFileSync(path.join(root, 'other.png'), original)
    fs.writeFileSync(path.join(root, 'index.html'), '<img src="view.png"><img src="product.png"><a download href="view.png">original</a>')
    fs.writeFileSync(path.join(root, 'collection-data.json'), JSON.stringify({ designs: [{ hero: 'view.png', views: [{ image: 'view.png', sha256: 'legacy-source-hash' }, { image: 'other.png' }], products: [{ image: 'product.png' }] }] }))
    const first = await convert(root, { executablePath }), data1 = JSON.parse(fs.readFileSync(path.join(root, 'collection-data.json')))
    assert.ok(first.encoded > 0); assert.match(data1.designs[0].views[0].image, /\.[a-f0-9]{24}\.webp$/)
    assert.equal(data1.designs[0].views[0].sha256, undefined)
    assert.notEqual(data1.designs[0].views[0].sourceSha256, data1.designs[0].views[0].servedSha256)
    const second = await convert(root, { executablePath }); assert.equal(second.encoded, 0); assert.ok(second.reused > 0)
    fs.writeFileSync(path.join(root, 'view.png'), replacement)
    const third = await convert(root, { executablePath }), data3 = JSON.parse(fs.readFileSync(path.join(root, 'collection-data.json')))
    assert.equal(third.encoded, 1); assert.equal(third.reused, 1); assert.notEqual(data3.designs[0].views[0].image, data1.designs[0].views[0].image)
    assert.ok(fs.existsSync(path.join(root, data1.designs[0].views[0].image)), 'earlier served image retained')
    const fourth = await convert(root, { executablePath, quality: 0.7 }); assert.ok(fourth.encoded > 0)
    assert.deepEqual(fs.readFileSync(path.join(root, 'product.png')), original)
    assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /download href="view.png"/)
    assert.deepEqual(fs.readFileSync(path.join(root, 'view.png')), replacement)
  } finally { await browser.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('a source under a symlink/junction cannot read an image outside the gallery', async t => {
  const base = fs.mkdtempSync(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../'), 'webp-boundary-test-'))
  const root = path.join(base, 'gallery'), outside = path.join(base, 'outside')
  fs.mkdirSync(root); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'view.png'), 'synthetic private image sentinel')
  try {
    try { fs.symlinkSync(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir') } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('platform prevents synthetic symlink creation'); return } throw error }
    fs.writeFileSync(path.join(root, 'collection-data.json'), JSON.stringify({ designs: [{ hero: 'link/view.png', views: [], products: [] }] }))
    await assert.rejects(convert(root, { executablePath: process.env.UNIT408_CHROMIUM || chromium.executablePath() }), /unsafe symlink/)
    assert.deepEqual(fs.readdirSync(outside), ['view.png'])
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})
