"""Regression checks for shared preferences beside the unified collection."""
import json
from pathlib import Path
import shutil
import unittest
import uuid

from patch_gallery import patch


class GalleryPatchTests(unittest.TestCase):
    def setUp(self):
        self.owner = Path(__file__).resolve().parent
        self.root = self.owner / ('.test-tmp-patch-' + uuid.uuid4().hex)
        self.root.mkdir(mode=0o755)

    def tearDown(self):
        resolved = self.root.resolve()
        if resolved.parent != self.owner or not resolved.name.startswith('.test-tmp-patch-'):
            raise RuntimeError('Refusing cleanup outside the test fixture')
        shutil.rmtree(resolved)

    def fixture(self, split):
        for board, item_id in [('def', 'D-BED'), ('ghi', 'G-BED'), ('jkl', 'J-BED'), ('mno', 'M-BED')]:
            folder = self.root if board == 'def' else self.root / board
            folder.mkdir(exist_ok=True)
            name = 'fable-def.html' if split and board == 'def' else 'index.html'
            (folder / name).write_text(
                '<html><head><title>Unit 408 — Example</title>'
                '<meta content="default-src \'self\'; script-src \'self\';">'
                '<link href="site.css"><script src="site.js"></script></head><body>'
                f'<tr data-item-id="{item_id}"><td class="piece-name">Example bed</td></tr>'
                '</body></html>', encoding='utf-8')
            (folder / 'site.js').write_text('window.unit408Picks = {};\n', encoding='utf-8')
            (folder / 'site.css').write_text('body { color: black; }\n', encoding='utf-8')
            (folder / 'data').mkdir()
            (folder / 'data' / 'designs.json').write_text(json.dumps({'items': [{
                'id': item_id, 'name': 'Example bed', 'role': 'bed', 'family': 'Example Family',
                'variant': 'Natural', 'url': 'https://supplier.example/bed?variant=natural',
                'catalogue_record': 'private-lineage-must-not-be-published'}]}), encoding='utf-8')
        if split:
            (self.root / 'index.html').write_text(
                '<html><script src="collection.js"></script><a href="fable-def.html?shared-picks=1#picks">Shared shortlist</a></html>', encoding='utf-8')
            (self.root / 'collection.js').write_text('/* Independent collection runtime. */', encoding='utf-8')
            (self.root / 'collection-data.json').write_text('{"schemes":[]}', encoding='utf-8')

    def test_split_collection_is_preserved_and_def_links_use_compatibility_page(self):
        self.fixture(split=True)
        protected = {name: (self.root / name).read_bytes() for name in
                     ['index.html', 'collection.js', 'collection-data.json', 'data/designs.json']}
        boards = patch(self.root, 'https://api.example/api/picks', self.root / 'catalog.json')
        self.assertEqual(set(boards), {'def', 'ghi', 'jkl', 'mno'})
        self.assertEqual(json.loads((self.root / 'catalog.json').read_text()),
                         ['ghi:G-BED', 'def:D-BED', 'jkl:J-BED', 'mno:M-BED'])
        for name, original in protected.items():
            self.assertEqual((self.root / name).read_bytes(), original, name)
        for folder in [self.root, self.root / 'ghi', self.root / 'jkl', self.root / 'mno']:
            script = (folder / 'site.js').read_text(encoding='utf-8')
            self.assertIn('/bedroom-design-options/fable-def.html?shared-picks=1#row-D-BED', script)
            self.assertIn('"family": "Example Family"', script)
            self.assertIn('Unit408Preferences', script)
            self.assertNotIn('private-lineage-must-not-be-published', script)
        self.assertIn('site.js?v=', (self.root / 'fable-def.html').read_text())

    def test_original_root_layout_still_works(self):
        self.fixture(split=False)
        patch(self.root, 'https://api.example/api/picks', self.root / 'catalog.json')
        script = (self.root / 'site.js').read_text(encoding='utf-8')
        self.assertIn('/bedroom-design-options/?shared-picks=1#row-D-BED', script)
        self.assertNotIn('/bedroom-design-options/fable-def.html?', script)
        self.assertIn('site.js?v=', (self.root / 'index.html').read_text())

    def test_repatch_is_idempotent_in_the_split_layout(self):
        self.fixture(split=True)
        patch(self.root, 'https://api.example/api/picks', self.root / 'catalog.json')
        before = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        patch(self.root, 'https://api.example/api/picks', self.root / 'catalog.json')
        after = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        self.assertEqual(after, before)


if __name__ == '__main__':
    unittest.main()
