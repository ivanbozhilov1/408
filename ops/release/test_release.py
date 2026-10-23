"""Synthetic acceptance fixtures only; never create a real image review attestation."""
import json
import hashlib
import os
import struct
import zlib
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from public_artifact import digest
from release import Hold, validate, prepare

HERE = Path(__file__).resolve().parents[2]

class ReleaseGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=HERE.parent); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name); self.gallery = self.base / 'gallery'; self.gallery.mkdir()
        for name in ('check_design.mjs', 'preferences.js'):
            path = self.gallery / 'ops/picks' / name; path.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(HERE / 'ops/picks' / name, path)
        self.git('init'); self.git('add', '.'); self.git('-c', 'user.email=synthetic@example.invalid', '-c', 'user.name=Synthetic test', 'commit', '-m', 'fixture')
        self.write('native.txt', 'synthetic native input'); self.write('image.png', 'synthetic reviewed image bytes')
        self.write('contract.json', {'schema': 'design-pack-inputs/v1', 'expires_at': (datetime.now(timezone.utc)+timedelta(days=1)).isoformat()})
        self.write('brief.json', {'briefSchema': 1, 'preferenceSchema': 2, 'revision': 7, 'preferred': [], 'excluded': [], 'conflicts': [], 'unresolved': [], 'requiresVisualReview': True})
        self.write('candidates.json', {'preferenceRevision': 7, 'items': [{'id': 'bed', 'name': 'Synthetic bed', 'role': 'bed', 'url': 'https://example.invalid/bed', 'family': 'Synthetic fixture', 'brand': 'Fixture', 'sku': 'B', 'materials': 'wood'}]})
        result = subprocess.run(['node', str(self.gallery/'ops/picks/check_design.mjs'), '--brief', str(self.base/'brief.json'), '--candidates', str(self.base/'candidates.json')], check=True, capture_output=True, text=True)
        self.write('gate.json', json.loads(result.stdout))
        native_record = self.bound('native.txt')
        native_record['path'] = str(self.base / 'native.txt')
        contract = {'schema': 'design-pack-inputs/v1', 'expires_at': (datetime.now(timezone.utc)+timedelta(days=1)).isoformat(), 'sources': {group: [native_record] for group in ('dimension_owner', 'geometry', 'cameras', 'scene', 'lighting', 'visibility', 'owner_rules', 'preferences', 'exclusions')}, 'products': [{**native_record, 'item_id': 'bed'}], 'fixed': [native_record], 'source_review': native_record, 'distinctness_review': native_record, 'preference_gate': {'checker': {'sha256': digest(self.gallery/'ops/picks/check_design.mjs')}, 'dependency': {'sha256': digest(self.gallery/'ops/picks/preferences.js')}, 'brief': self.bound('brief.json'), 'candidates': self.bound('candidates.json'), 'result_sha256': self.bound('gate.json')['sha256'], 'revision': 7}}
        contract['contract_sha256'] = hashlib.sha256(json.dumps(contract, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        for group in ('preferences', 'exclusions'):
            contract['sources'][group] = [{**native_record, 'revision': 7}]
        contract['jobs'] = {'view': {'visible_product_ids': ['bed']}}
        contract.pop('contract_sha256')
        contract['contract_sha256'] = hashlib.sha256(json.dumps(contract, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        self.write('contract.json', contract)
        native = [self.bound('native.txt')]; source = [self.bound('image.png')]; stamp = datetime.now(timezone.utc).isoformat()
        self.write('review.json', {'accepted': True, 'independent': True, 'reviewer': {'id': 'synthetic fixture', 'role': 'independent'}, 'unresolvedCritical': [], 'acceptedAt': stamp, 'contractSha256': self.bound('contract.json')['sha256'], 'nativeInputs': native, 'sourceImages': source, 'preference': {'revision': 7, 'exclusionRevision': 7}})
        self.accepted = {'schema': 1, 'galleryHead': self.git('rev-parse', 'HEAD'), 'acceptedAt': stamp, 'contract': self.bound('contract.json'), 'nativeInputs': native, 'sourceImages': source, 'preference': {'revision': 7, 'checkedRevision': 7, 'exclusionRevision': 7, 'checkedExclusionRevision': 7}, 'review': self.bound('review.json'), 'candidateGate': {'checkerSha256': digest(self.gallery/'ops/picks/check_design.mjs'), 'preferencesSha256': digest(self.gallery/'ops/picks/preferences.js'), 'preferenceRevision': 7, 'brief': self.bound('brief.json'), 'candidates': self.bound('candidates.json'), 'result': self.bound('gate.json')}, 'views': [{'id': 'view', 'sourcePath': 'image.png', 'sourceSha256': self.bound('image.png')['sha256'], 'destination': 'renders/view.png', 'productIds': ['bed'], 'width': 2, 'height': 2}]}
        self.catalogue = self.write('catalogue.json', {'service': 'unit408-picks', 'independentReadback': True, 'verifiedAt': stamp, 'ids': ['bed']})
        self.manifest = self.write('accepted.json', self.accepted)
        self.accepted['productBindings'] = [{'catalogueId': 'bed', 'candidateId': 'bed', 'photoSha256': native_record['sha256']}]
        self.write('accepted.json', self.accepted)
    def write(self, name, value):
        p = self.base / name; p.write_text(json.dumps(value) if not isinstance(value, str) else value, encoding='utf-8'); return p
    def bound(self, name):
        return {'path': name, 'sha256': digest(self.base/name)}
    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.gallery), *args], check=True, capture_output=True, text=True).stdout.strip()
    def check(self):
        self.write('accepted.json', self.accepted); return validate(self.manifest, self.gallery, self.catalogue)
    def test_valid_local_admission_has_no_network_mutation(self):
        original = subprocess.run; calls = []
        def record(cmd, **kwargs):
            calls.append(cmd); return original(cmd, **kwargs)
        with patch('release.subprocess.run', side_effect=record):
            accepted, result = self.check()
        self.assertFalse(result['remoteTipVerified']); self.assertEqual(result['requiredIds'], ['bed'])
        self.assertFalse(any(cmd[0] not in ('git', 'node') for cmd in calls))
        self.assertFalse(any(any(word in cmd for word in ('push', 'fetch', 'curl', 'ssh')) for cmd in calls))
    def test_missing_catalogue_exact_hold(self):
        self.write('catalogue.json', {'service': 'unit408-picks', 'independentReadback': True, 'verifiedAt': datetime.now(timezone.utc).isoformat(), 'ids': []})
        with self.assertRaisesRegex(Hold, 'missing catalogue IDs: bed'):
            self.check()
    def test_stale_catalogue_hold(self):
        self.write('catalogue.json', {'service': 'unit408-picks', 'independentReadback': True, 'verifiedAt': '2000-01-01T00:00:00Z', 'ids': ['bed']})
        with self.assertRaisesRegex(Hold, 'older than 24'):
            self.check()
    def test_changed_image_invalidates_review(self):
        self.write('image.png', 'changed')
        with self.assertRaisesRegex(Hold, 'hash changed'):
            self.check()
    def test_changed_review_fails(self):
        self.write('review.json', '{}')
        with self.assertRaisesRegex(Hold, 'independent review hash changed'):
            self.check()
    def test_changed_head_fails(self):
        self.accepted['galleryHead'] = '0'*40
        with self.assertRaisesRegex(Hold, 'HEAD changed'):
            self.check()
    def test_preference_revision_changed_fails(self):
        self.accepted['preference']['checkedExclusionRevision'] = 6
        with self.assertRaisesRegex(Hold, 'revision stale'):
            self.check()
    def test_expired_contract_fails(self):
        self.write('contract.json', {'schema': 'design-pack-inputs/v1', 'expires_at': '2000-01-01T00:00:00Z'}); self.accepted['contract'] = self.bound('contract.json')
        with self.assertRaisesRegex(Hold, 'expired'):
            self.check()
    def test_candidate_changed_fails(self):
        self.write('candidates.json', '{}')
        with self.assertRaisesRegex(Hold, 'candidate list hash changed'):
            self.check()
    @unittest.skipUnless(os.environ.get('UNIT408_CHROMIUM'), 'explicit installed Chromium required for full synthetic prepare')
    def test_full_synthetic_prepare_stages_changed_assets_without_touching_checkout(self):
        def chunk(kind, data):
            return struct.pack('!I', len(data))+kind+data+struct.pack('!I', zlib.crc32(kind+data)&0xffffffff)
        png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', struct.pack('!2I5B', 1, 1, 8, 6, 0, 0, 0))+chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00\xff'))+chunk(b'IEND', b'')
        (self.base/'image.png').write_bytes(png)
        for name in ('old.png', 'product.png'):
            (self.gallery/name).write_bytes(png)
        (self.gallery/'index.html').write_text('<script src="site.js"></script><img src="old.png">')
        (self.gallery/'site.js').write_text("fetch('collection-data.json')")
        (self.gallery/'collection-data.json').write_text(json.dumps({'designs': [{'id': 'fixture', 'hero': 'old.png', 'views': [{'slot': 'view', 'image': 'old.png'}], 'products': [{'id': 'bed', 'image': 'product.png'}]}]}))
        code = self.gallery/'ops/images/webp_views.mjs'; code.parent.mkdir(); shutil.copyfile(HERE/'ops/images/webp_views.mjs', code)
        self.git('add', '.'); self.git('-c', 'user.email=synthetic@example.invalid', '-c', 'user.name=Synthetic test', 'commit', '-m', 'public fixture')
        self.accepted['galleryHead'] = self.git('rev-parse', 'HEAD'); self.accepted['sourceImages'] = [self.bound('image.png')]
        view = self.accepted['views'][0]; view.update({'sourceSha256': digest(self.base/'image.png'), 'designId': 'fixture', 'slot': 'view', 'width': 1, 'height': 1})
        review = json.loads((self.base/'review.json').read_text()); review['sourceImages'] = self.accepted['sourceImages']; self.write('review.json', review); self.accepted['review'] = self.bound('review.json'); self.write('accepted.json', self.accepted)
        before = digest(self.gallery/'collection-data.json')
        result = prepare(self.gallery, self.manifest, self.base/'prepared', self.catalogue, Path(os.environ['UNIT408_CHROMIUM']))
        self.assertEqual(result['status'], 'LOCAL_PREPARED'); self.assertEqual(result['servedImages'][0]['width'], 1)
        self.assertEqual(digest(self.gallery/'collection-data.json'), before)
        self.assertTrue((self.base/'prepared/changed-assets/collection-data.json').is_file())
        self.assertEqual(result['deployment']['status'], 'NOT_STARTED')

if __name__ == '__main__': unittest.main()
