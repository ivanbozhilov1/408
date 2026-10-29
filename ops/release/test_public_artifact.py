import json
import os
from pathlib import Path
import re
import struct
import tempfile
import unittest
import zlib
from public_artifact import build, reachable

class PublicArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[3]); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name); self.root = self.base / 'gallery'; self.root.mkdir()
    def write(self, name, value):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(value, encoding='utf-8'); return path
    def test_reachable_archive_downloads_and_product_photos_retained_private_excluded(self):
        self.write('index.html', '<script src="site.js"></script><img src="product.png"><a href="original.png" download>original</a>')
        self.write('archive/index.html', '<img src="../archived.webp">')
        self.write('site.js', "fetch('data.json'); const name='not-a-real-download.json';")
        self.write('data.json', json.dumps({'hero': 'current.webp', 'label': 'not-a-real-image.png', 'sourceImage': 'unused-source.png'}))
        for name in ('product.png', 'original.png', 'archived.webp', 'current.webp', 'unused-source.png'):
            self.write(name, 'synthetic image')
        self.write('ops/private-preferences.json', 'private'); self.write('review-receipt.json', 'private'); self.write('unreferenced.png', 'old original')
        result = build(self.root, self.base / 'public', encode=False)
        files = {r['path'] for r in result['files']}
        self.assertTrue({'index.html', 'archive/index.html', 'product.png', 'original.png', 'archived.webp', 'current.webp'} <= files)
        self.assertFalse({'ops/private-preferences.json', 'review-receipt.json', 'unused-source.png', 'unreferenced.png'} & files)
        self.assertTrue((self.root / 'unreferenced.png').exists())
    def test_missing_link_fails(self):
        self.write('index.html', '<img src="missing.png">')
        with self.assertRaisesRegex(ValueError, 'missing'):
            reachable(self.root)
    def test_site_root_links_resolve_under_408_only(self):
        self.write('index.html', '<img src="/408/assets/hero.webp"><a href="/408/ghi/?shared-picks=1#row-G-BED">set</a>')
        self.write('assets/hero.webp', 'synthetic image'); self.write('ghi/index.html', '<p>set</p>')
        self.assertIn('assets/hero.webp', {p.relative_to(self.root.resolve()).as_posix() for p in reachable(self.root)})
        self.write('index.html', '<img src="/bedroom-design-options/assets/hero.webp">')
        with self.assertRaisesRegex(ValueError, 'missing'):
            reachable(self.root)
    def test_traversal_fails(self):
        self.write('index.html', '<a href="../outside.pdf">escape</a>')
        with self.assertRaisesRegex(ValueError, 'traversal'):
            reachable(self.root)
    def test_private_reference_fails(self):
        self.write('index.html', '<script src="ops/private.js"></script>'); self.write('ops/private.js', 'secret')
        with self.assertRaisesRegex(ValueError, 'private'):
            reachable(self.root)
    def test_literal_credentials_fail(self):
        self.write('index.html', '<a href="https://example.org/#token=' + 'SYNTHETIC' * 5 + '">bad</a>')
        with self.assertRaisesRegex(ValueError, 'credential'):
            reachable(self.root)
    def test_editor_role_link_and_encoded_token_rejected_without_disclosure(self):
        for ref in ('#sync=SYNTHETIC_EDITOR_TOKEN', '%23sync%3DSYNTHETIC_EDITOR_TOKEN', '%2523sync%253DSYNTHETIC_EDITOR_TOKEN'):
            self.write('index.html', '<a href="' + ref + '">access</a>')
            with self.assertRaisesRegex(ValueError, 'credential') as result:
                reachable(self.root)
            self.assertNotIn('SYNTHETIC_EDITOR_TOKEN', str(result.exception))
    def test_existing_or_nested_output_fails(self):
        self.write('index.html', '<p>safe</p>')
        with self.assertRaises(ValueError):
            build(self.root, self.root / 'public', encode=False)
    @unittest.skipUnless(os.environ.get('UNIT408_CHROMIUM'), 'explicit installed Chromium required for encoding')
    def test_encoded_build_serves_flat_png_as_lossless_webp_and_reports_asset_encoding(self):
        def chunk(kind, data):
            return struct.pack('!I', len(data))+kind+data+struct.pack('!I', zlib.crc32(kind+data)&0xffffffff)
        # A flat white 64x64 PNG stored without compression: its lossless WebP is far more than 10% smaller.
        rows = b''.join(b'\x00'+b'\xff\xff\xff'*64 for _ in range(64))
        png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', struct.pack('!2I5B', 64, 64, 8, 2, 0, 0, 0))+chunk(b'IDAT', zlib.compress(rows, 0))+chunk(b'IEND', b'')
        (self.root / 'plan.png').write_bytes(png); self.write('index.html', '<img src="plan.png">')
        images = Path(__file__).resolve().parents[1] / 'images'
        result = build(self.root, self.base / 'public', chromium=os.environ['UNIT408_CHROMIUM'], encoder_script=images / 'webp_views.mjs')
        counts = {k: result['assetEncoding'][k] for k in ('referenced', 'converted', 'keptOriginal', 'encoded', 'lossless')}
        self.assertEqual(counts, {'referenced': 1, 'converted': 1, 'keptOriginal': 0, 'encoded': 1, 'lossless': 1})
        files = {r['path'] for r in result['files']}
        self.assertNotIn('plan.png', files)
        self.assertEqual(len([f for f in files if re.fullmatch(r'plan\.[0-9a-f]{24}\.webp', f)]), 1)

if __name__ == '__main__': unittest.main()
