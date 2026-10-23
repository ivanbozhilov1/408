"""Isolated regeneration regression: legacy-only output previously overwrote 627
allowed IDs with 243 and omitted Astra metadata from every embedded client.
Fixtures contain no private access or image assets; no network is used.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
TEST_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'ops/picks'))
import patch_gallery


class LegacyRegeneration(unittest.TestCase):
    def test_complete_catalogue_and_historical_ids_survive_repeated_regeneration(self):
        with tempfile.TemporaryDirectory(prefix='legacy-patcher-test-', dir=TEST_ROOT) as name:
            fixture = Path(name).resolve()
            # Validate the cleanup boundary before TemporaryDirectory removes it.
            self.assertTrue(fixture.is_relative_to(TEST_ROOT))
            for relative in ['index.html', 'fable-def.html', 'collection-data.json', 'ops/picks/catalog.json']:
                target = fixture / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, target)
            for board in ['', 'ghi', 'jkl', 'mno', 'stu']:
                for relative in ['site.js', 'site.css', 'data/designs.json'] + (['index.html'] if board else []):
                    target = fixture / board / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(ROOT / board / relative, target)
            index_hash = hashlib.sha256((fixture / 'index.html').read_bytes()).hexdigest()
            allowed_path = fixture / 'ops/picks/catalog.json'
            original_ids = json.loads(allowed_path.read_text())
            historic = 'historical:retained-regeneration-fixture'
            allowed_path.write_text(json.dumps(original_ids + [historic]), encoding='utf-8')
            expected = {x['id'] for x in json.loads((ROOT / 'collection-catalog.json').read_text(encoding='utf-8'))['items']}
            self.assertEqual(len(expected), 680)
            for _ in range(2):
                boards = patch_gallery.patch(fixture, 'https://seo.cebugrandrealty.com:8443/api/picks', allowed_path)
                self.assertEqual(set(boards), {'def', 'ghi', 'jkl', 'mno', 'stu'})
                allowed = set(json.loads(allowed_path.read_text()))
                self.assertTrue(expected <= allowed)
                self.assertTrue(set(original_ids) <= allowed)
                self.assertIn(historic, allowed)
                self.assertEqual(hashlib.sha256((fixture / 'index.html').read_bytes()).hexdigest(), index_hash)
                for board in ['', 'ghi', 'jkl', 'mno', 'stu']:
                    script = (fixture / board / 'site.js').read_text(encoding='utf-8')
                    match = re.search(r'  const CATALOG = (\[.*?\]);\n', script)
                    self.assertIsNotNone(match)
                    entries = json.loads(match[1])
                    self.assertEqual({x['id'] for x in entries}, expected)
                    self.assertEqual(len(entries), 680)
                    legacy = [x for x in entries if re.match(r'^(def|ghi|jkl|mno|stu):', x['id'])]
                    self.assertEqual(len(legacy), 296)
                    for item in legacy:
                        self.assertIn('?shared-picks=1#row-', item['url'])
                        self.assertTrue(item['product'].get('name'))
                    self.assertTrue(all('#design=' in x['url'] for x in entries if x not in legacy))
                    self.assertIn('exclusionMatches(entries.get(operation.id), excluded)', script)


if __name__ == '__main__':
    unittest.main()
