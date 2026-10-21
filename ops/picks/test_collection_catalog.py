import json
import tempfile
import unittest
from pathlib import Path

from collection_catalog import build


class CollectionCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / 'ops/picks').mkdir(parents=True)
        self.designs = []
        self.legacy = []
        for board in ('def', 'ghi', 'jkl', 'mno'):
            folder = self.root if board == 'def' else self.root / board
            (folder / 'data').mkdir(parents=True)
            item = {'id': 'BED', 'name': board + ' bed', 'role': 'bed',
                    'url': 'https://example.com/' + board, 'family': board,
                    'privatePath': 'must not be published'}
            (folder / 'data/designs.json').write_text(json.dumps({'items': [item]}))
            local_id = 'fable-' + board + '::BED'
            self.designs.append({'id': board, 'namespace': 'fable-' + board, 'author': 'Fable',
                                 'letter': board, 'name': board,
                                 'products': [{'id': local_id, 'name': item['name'],
                                               'legacyIds': [board + ':BED']}]})
            self.legacy.append(board + ':BED')
        self.astra = {'id': 'astra::P', 'namespace': 'astra', 'author': 'Astra', 'letter': 'P', 'name': 'P',
                      'products': [{'id': 'astra::BED', 'name': 'New bed', 'category': 'Bed frame',
                                    'source': 'https://example.com/astra', 'legacyIds': []}]}
        self.designs.append(self.astra)
        self.save()

    def tearDown(self):
        self.temporary.cleanup()

    def save(self, extra_ids=()):
        (self.root / 'collection-data.json').write_text(json.dumps({'designs': self.designs}))
        (self.root / 'ops/picks/catalog.json').write_text(json.dumps(self.legacy + list(extra_ids)))

    def test_existing_ids_are_stable_and_new_ids_are_namespaced(self):
        receipt = build(self.root)
        self.assertEqual(receipt['items'], 5)
        ids = json.loads((self.root / 'ops/picks/catalog.json').read_text())
        self.assertEqual(ids, self.legacy + ['astra::BED'])
        entries = json.loads((self.root / 'collection-catalog.json').read_text())['items']
        self.assertEqual(entries[0]['localId'], 'fable-def::BED')
        self.assertNotIn('privatePath', entries[0]['product'])

    def test_common_item_has_one_rating_across_its_design_occurrences(self):
        alternate = dict(self.astra, id='astra::Q', letter='Q')
        self.designs.append(alternate)
        self.save()
        self.assertEqual(build(self.root)['items'], 5)
        entry = json.loads((self.root / 'collection-catalog.json').read_text())['items'][-1]
        self.assertEqual(entry['designIds'], ['astra::P', 'astra::Q'])

    def test_catalogue_keeps_previously_allowed_historical_ids(self):
        self.save(['retired::item'])
        build(self.root)
        self.assertIn('retired::item', json.loads((self.root / 'ops/picks/catalog.json').read_text()))

    def test_ambiguous_identity_is_rejected(self):
        self.astra['products'][0]['legacyIds'] = ['def:BED', 'ghi:BED']
        self.save()
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            build(self.root)

    def test_generation_is_idempotent(self):
        build(self.root)
        first = (self.root / 'ops/picks/catalog.json').read_bytes()
        display = (self.root / 'collection-catalog.json').read_bytes()
        build(self.root)
        self.assertEqual(first, (self.root / 'ops/picks/catalog.json').read_bytes())
        self.assertEqual(display, (self.root / 'collection-catalog.json').read_bytes())


if __name__ == '__main__':
    unittest.main()
