import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
const directory = path.dirname(fileURLToPath(import.meta.url)), sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const close = server => new Promise(resolve => server.close(resolve))
test('foreign requests, redirect escapes and encoded derivative traversals never leave the allowed public base', async () => {
  const temp = fs.mkdtempSync(path.resolve(directory, '../../../readback-test-'))
  let foreignHits = 0, forbiddenHits = 0, redirectHits = 0
  const foreign = http.createServer((req, res) => { foreignHits++; res.end('forbidden') })
  await listen(foreign)
  const foreignUrl = `http://127.0.0.1:${foreign.address().port}/private`
  let derivative, manifest
  const html = `<script>fetch('${foreignUrl}').catch(()=>{});fetch('redirect').catch(()=>{});fetch('redirect-local').catch(()=>{});</script><img src="${foreignUrl}"><p>synthetic fixture</p>`
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture')
    if (url.pathname === '/outside') { forbiddenHits++; res.end('forbidden'); return }
    if (url.pathname === '/public/redirect') { redirectHits++; res.writeHead(302, { Location: foreignUrl }); res.end(); return }
    if (url.pathname === '/public/redirect-local') { redirectHits++; res.writeHead(302, { Location: '/outside' }); res.end(); return }
    res.setHeader('Content-Type', url.pathname.endsWith('.json') ? 'application/json' : 'text/html')
    if (url.pathname === '/public/public-manifest.json') res.end(JSON.stringify(manifest))
    else if (url.pathname === '/public/render-derivatives.json') res.end(JSON.stringify(derivative))
    else if (url.pathname === '/public/' || url.pathname === '/public/index.html') res.end(html)
    else { res.writeHead(404); res.end() }
  })
  await listen(server)
  const base = `http://127.0.0.1:${server.address().port}/public/`
  const run = async () => {
    const manifestFile = path.join(temp, 'public-manifest.json'); fs.writeFileSync(manifestFile, JSON.stringify(manifest))
    return new Promise(resolve => {
      const child = spawn(process.execPath, [path.join(directory, 'readback.mjs'), '--manifest', manifestFile, '--base-url', base, '--chromium', process.env.UNIT408_CHROMIUM || chromium.executablePath()], { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', bytes => { output += bytes }); child.stderr.on('data', bytes => { output += bytes }); child.on('close', code => resolve({ code, output }))
    })
  }
  try {
    const index = { path: 'index.html', bytes: Buffer.byteLength(html), sha256: sha(html) }
    manifest = { files: [index] }
    assert.equal((await run()).code, 0)
    assert.ok(redirectHits > 0); assert.equal(foreignHits, 0); assert.equal(forbiddenHits, 0)
    for (const servedPath of [foreignUrl, '//127.0.0.1/private', '../outside', '%2e%2e/outside', '%252e%252e/outside', 'nested\\outside']) {
      derivative = { derivatives: [{ servedPath, width: 1, height: 1, servedSha256: 'synthetic' }] }
      const bytes = JSON.stringify(derivative)
      manifest = { files: [index, { path: 'render-derivatives.json', bytes: Buffer.byteLength(bytes), sha256: sha(bytes) }] }
      const result = await run(); assert.notEqual(result.code, 0); assert.match(result.output, /unsafe readback/)
      assert.equal(foreignHits, 0); assert.equal(forbiddenHits, 0)
    }
  } finally { await close(server); await close(foreign); fs.rmSync(temp, { recursive: true, force: true }) }
})
