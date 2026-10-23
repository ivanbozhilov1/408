"""Guarded local release preparation and independent public byte/browser readback.

prepare never changes the checkout, the picks API, Git refs, or a remote deployment.
"""
from __future__ import annotations
import argparse
import hashlib
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
# make_pack launches this canonical entrypoint with Python -I. Resolve only its
# own trusted sibling modules; never import release helpers from the caller's cwd.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from public_artifact import build, digest, reachable, resolve

class Hold(ValueError):
    pass

def now():
    return datetime.now(timezone.utc).isoformat()

def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)

def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True, text=True).stdout.strip()

def bound_file(base, record, label):
    path = (base / record['path']).resolve()
    if not path.is_file() or path.is_symlink() or digest(path) != record['sha256']:
        raise Hold(f'{label} hash changed or file missing: {record["path"]}')
    return path

def validate(accepted_path: Path, gallery: Path, catalogue_path: Path | None):
    accepted = json.loads(accepted_path.read_text(encoding='utf-8'))
    if accepted.get('schema') != 1 or not accepted.get('views'):
        raise Hold('accepted manifest schema 1 and nonempty views required')
    base = accepted_path.parent
    head = git(gallery, 'rev-parse', 'HEAD')
    if accepted.get('galleryHead') != head:
        raise Hold(f'gallery HEAD changed; expected {accepted.get("galleryHead")}, actual {head}')
    # A published release must be made from a committed, reviewable checkout.
    if git(gallery, 'status', '--porcelain', '--untracked-files=no'):
        raise Hold('tracked gallery files are uncommitted; commit reviewed tooling/content first')
    target = head; remote = False
    if 'origin' in git(gallery, 'remote').splitlines():
        target = git(gallery, 'ls-remote', '--exit-code', 'origin', 'refs/heads/main').split()[0]
        if accepted.get('targetHead') != target:
            raise Hold(f'latest origin/main changed; expected {accepted.get("targetHead")}, actual {target}')
        git(gallery, 'merge-base', '--is-ancestor', target, head)
        remote = True
    contract_path = bound_file(base, accepted['contract'], 'contract')
    contract = json.loads(contract_path.read_text(encoding='utf-8'))
    if contract.get('schema') != 'design-pack-inputs/v1':
        raise Hold('design-pack-inputs/v1 frozen input contract required')
    if not contract.get('expires_at') or timestamp(contract['expires_at']) <= datetime.now(timezone.utc):
        raise Hold('frozen input contract expired')
    unsigned = {k: v for k, v in contract.items() if k != 'contract_sha256'}
    intrinsic = hashlib.sha256(json.dumps(unsigned, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')).hexdigest()
    if contract.get('contract_sha256') != intrinsic:
        raise Hold('frozen input contract intrinsic hash differs')
    native = accepted.get('nativeInputs', []); sources = accepted.get('sourceImages', [])
    if not native or not sources:
        raise Hold('native input and source image hash bindings required')
    for record in native + sources:
        bound_file(base, record, 'native/source image')
    native_hashes = {str((base / r['path']).resolve()): r['sha256'] for r in native}
    frozen = []
    for group in ('dimension_owner', 'geometry', 'cameras', 'scene', 'lighting', 'visibility', 'owner_rules', 'preferences', 'exclusions'):
        records = contract.get('sources', {}).get(group)
        if not records:
            raise Hold('frozen native input missing: ' + group)
        frozen.extend(records)
    if not contract.get('products') or not contract.get('fixed'):
        raise Hold('frozen selected product photos/fixed inputs required')
    frozen += contract['products'] + contract['fixed'] + [contract['source_review'], contract['distinctness_review']]
    for record in frozen:
        path = bound_file(base, record, 'frozen native/product/review')
        if native_hashes.get(str(path)) != record['sha256']:
            raise Hold('independent review nativeInputs omit frozen input: ' + record['path'])
    preference = accepted.get('preference', {})
    for key in ('revision', 'exclusionRevision'):
        if preference.get(key) is None or preference.get('checked' + key[0].upper() + key[1:]) != preference[key]:
            raise Hold(f'preference/exclusion revision stale: {key}')
    for group, key in (('preferences', 'revision'), ('exclusions', 'exclusionRevision')):
        if any(r.get('revision') != preference[key] for r in contract['sources'][group]):
            raise Hold('frozen ' + group + ' revision differs from accepted manifest')
    gate = accepted.get('candidateGate', {})
    checker = gallery / 'ops/picks/check_design.mjs'; preferences = gallery / 'ops/picks/preferences.js'
    usage = gallery / 'ops/picks/usage.js'
    if gate.get('checkerSha256') != digest(checker) or gate.get('preferencesSha256') != digest(preferences) or gate.get('usageSha256') != digest(usage) or gate.get('preferenceRevision') != preference['revision']:
        raise Hold('current deterministic candidate gate and exact preference revision binding required')
    frozen_gate = contract.get('preference_gate', {})
    if frozen_gate.get('checker', {}).get('sha256') != gate['checkerSha256'] or frozen_gate.get('dependency', {}).get('sha256') != gate['preferencesSha256'] or frozen_gate.get('usage_dependency', {}).get('sha256') != gate['usageSha256'] or frozen_gate.get('revision') != preference['revision']:
        raise Hold('candidate gate differs from frozen contract')
    brief = bound_file(base, gate['brief'], 'candidate brief'); candidates = bound_file(base, gate['candidates'], 'candidate list'); result = bound_file(base, gate['result'], 'candidate gate result')
    brief_data = json.loads(brief.read_text(encoding='utf-8'))
    if frozen_gate.get('brief', {}).get('sha256') != digest(brief) or frozen_gate.get('candidates', {}).get('sha256') != digest(candidates) or frozen_gate.get('result_sha256') != digest(result):
        raise Hold('candidate gate exact input/result bytes differ from frozen contract')
    if brief_data.get('revision') != preference['revision']:
        raise Hold('candidate brief preference revision differs')
    command = ['node', str(checker), '--brief', str(brief), '--candidates', str(candidates)]
    collection_record = gate.get('collection')
    if bool(collection_record) != bool(frozen_gate.get('collection')) or (brief_data.get('generation', {}).get('unusedItemsOnly') is True and not collection_record):
        raise Hold('unused-product policy requires the current frozen collection binding')
    if collection_record:
        collection = bound_file(base, collection_record, 'candidate usage collection')
        if collection != (gallery / 'collection-data.json').resolve() or not collection.is_relative_to(gallery) or frozen_gate['collection'].get('sha256') != digest(collection):
            raise Hold('candidate usage collection differs from current canonical gallery collection')
        command.extend(['--collection', str(collection)])
    replay = subprocess.run(command, capture_output=True, text=True)
    expected_result = json.loads(result.read_text(encoding='utf-8'))
    if replay.returncode or expected_result.get('ok') is not True or json.loads(replay.stdout) != expected_result:
        raise Hold('candidate gate replay blocked or differs from bound PASS result')
    review_path = bound_file(base, accepted['review'], 'independent review')
    review = json.loads(review_path.read_text(encoding='utf-8'))
    if review.get('accepted') is not True or review.get('independent') is not True or review.get('unresolvedCritical') != [] or not review.get('reviewer', {}).get('id') or review.get('reviewer', {}).get('role') != 'independent':
        raise Hold('independent accepted review with no unresolved critical findings required')
    if review.get('contractSha256') != accepted['contract']['sha256'] or review.get('nativeInputs') != native or review.get('sourceImages') != sources:
        raise Hold('review is not bound to current contract/native inputs/source image hashes')
    if review.get('preference') != {key: preference[key] for key in ('revision', 'exclusionRevision')}:
        raise Hold('review preference/exclusion revision differs')
    accepted_at = timestamp(accepted['acceptedAt'])
    if accepted_at > datetime.now(timezone.utc) + timedelta(minutes=5) or timestamp(review['acceptedAt']) > accepted_at:
        raise Hold('invalid accepted/review timestamps')
    source_map = {r['path']: r['sha256'] for r in sources}
    for view in accepted['views']:
        if source_map.get(view['sourcePath']) != view['sourceSha256'] or not view.get('productIds') or not view.get('width') or not view.get('height'):
            raise Hold(f'view missing reviewed image/product/dimension binding: {view.get("id")}')
        if not view['destination'].lower().endswith('.png'):
            raise Hold('accepted view destination must name its original PNG')
        destination = (gallery / view['destination']).resolve()
        if not destination.is_relative_to(gallery) or any(p.startswith('.') for p in Path(view['destination']).parts) or 'ops' in Path(view['destination']).parts:
            raise Hold('unsafe view destination')
    needed = sorted({id for view in accepted['views'] for id in view['productIds']})
    candidate_data = json.loads(candidates.read_text(encoding='utf-8'))
    candidate_ids = {r['id'] for r in (candidate_data if isinstance(candidate_data, list) else candidate_data['items'])}
    photo_bindings = {(p['item_id'], p['sha256']) for p in contract['products']}
    bindings = {b['catalogueId']: b for b in accepted.get('productBindings', [])}
    for id in needed:
        binding = bindings.get(id, {})
        if binding.get('candidateId') not in candidate_ids or (binding.get('candidateId'), binding.get('photoSha256')) not in photo_bindings:
            raise Hold('stable catalogue ID lacks frozen candidate/photo binding: ' + id)
    for view in accepted['views']:
        job = contract.get('jobs', {}).get(view.get('jobId', view['id']))
        mapped = {bindings[id]['candidateId'] for id in view['productIds']}
        if not job or mapped != set(job.get('visible_product_ids', [])):
            raise Hold('view product identities differ from frozen visibility job: ' + view['id'])
    public_files = accepted.get('publicFiles', [])
    if review.get('publicFiles', []) != public_files:
        raise Hold('public file overlays are not bound to independent review')
    for record in public_files:
        bound_file(base, record, 'reviewed public file')
    if not catalogue_path:
        raise Hold('catalogue independent readback required; missing catalogue IDs: ' + ', '.join(needed))
    catalogue = json.loads(catalogue_path.read_text(encoding='utf-8'))
    if not isinstance(catalogue, dict) or catalogue.get('independentReadback') is not True or catalogue.get('service') != 'unit408-picks':
        raise Hold('catalogue must be sanitized independent readback of dedicated unit408-picks; a local ID list is insufficient')
    verified = timestamp(catalogue['verifiedAt'])
    if verified < datetime.now(timezone.utc) - timedelta(hours=24) or verified > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise Hold('catalogue independent readback older than 24 hours or future dated')
    missing = sorted(set(needed) - set(catalogue.get('ids', [])))
    if missing:
        raise Hold('missing catalogue IDs: ' + ', '.join(missing) + '; update only the dedicated API catalogue, independently read it back, then rerun prepare before gallery deployment')
    return accepted, {'head': head, 'targetHead': target, 'remoteTipVerified': remote, 'catalogueSha256': digest(catalogue_path), 'catalogueVerifiedAt': catalogue['verifiedAt'], 'requiredIds': needed}

def prepare(gallery, accepted_path, out, catalogue=None, chromium=None):
    gallery = gallery.resolve(); accepted_path = accepted_path.resolve(); out = out.resolve()
    started = time.perf_counter(); wall = now()
    accepted, checks = validate(accepted_path, gallery, catalogue)
    checked = time.perf_counter()
    if out.exists() or out.is_relative_to(gallery):
        raise Hold('output must be a fresh directory outside the gallery')
    # Copy only reachable public files and retained render originals; never private exports or API data.
    inputs = reachable(gallery); out.mkdir(parents=True); stage = out / 'stage'; stage.mkdir()
    for file in inputs:
        dest = stage / file.relative_to(gallery); dest.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(file, dest)
        if file.suffix == '.webp' and file.with_suffix('.png').is_file():
            shutil.copyfile(file.with_suffix('.png'), dest.with_suffix('.png'))
    derivative = gallery / 'render-derivatives.json'
    if derivative.is_file():
        shutil.copyfile(derivative, stage / derivative.name)
        for record in json.loads(derivative.read_text())['derivatives']:
            original = resolve(gallery, gallery / 'collection-data.json', record['sourcePath'])
            dest = stage / original.relative_to(gallery); dest.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(original, dest)
    changes = []
    for record in accepted.get('publicFiles', []):
        source = bound_file(accepted_path.parent, record, 'public file')
        destination = (stage / record['destination']).resolve()
        if not destination.is_relative_to(stage) or destination.suffix not in {'.html', '.css', '.js', '.json', '.svg', '.csv'} or 'ops' in destination.relative_to(stage).parts:
            raise Hold('unsafe public file overlay')
        old = digest(destination) if destination.is_file() else None
        destination.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, destination)
        if old != record['sha256']:
            changes.append({'path': record['destination'], 'beforeSha256': old, 'afterSha256': record['sha256']})
    datafile = stage / 'collection-data.json'; data = json.loads(datafile.read_text(encoding='utf-8'))
    for view in accepted['views']:
        source = bound_file(accepted_path.parent, {'path': view['sourcePath'], 'sha256': view['sourceSha256']}, 'view')
        destination = stage / view['destination']; old = digest(destination) if destination.is_file() else None
        destination.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, destination)
        if old != view['sourceSha256']:
            changes.append({'path': view['destination'], 'beforeSha256': old, 'afterSha256': view['sourceSha256']})
        matches = [v for d in data['designs'] if d['id'] == view.get('designId') for v in d.get('views', []) if v.get('slot', v.get('id')) == view.get('slot', view['id'])]
        if len(matches) != 1:
            raise Hold(f'exact designId/slot target required for {view["id"]}; add reviewed collection data via publicFiles for new sets')
        matches[0]['image'] = view['destination']
        for design in data['designs']:
            if design['id'] == view['designId'] and view.get('hero') is True:
                design['hero'] = view['destination']
    datafile.write_text(json.dumps(data, indent=2)+'\n', encoding='utf-8')
    # Keep executable/module resolution in this trusted installed checkout, while
    # the encoder reads only staged public data. Staging code loses node_modules
    # resolution when the fresh output is outside the repository (as in CI).
    encoder_script = Path(__file__).resolve().parents[1] / 'images/webp_views.mjs'
    staged = time.perf_counter(); public = build(stage, out / 'public', chromium=chromium, cache_dir=gallery / '.cache/render-webp', encoder_script=encoder_script)
    # Inputs and HEAD are checked again after encoding; changes cannot reuse earlier approval.
    validate(accepted_path, gallery, catalogue)
    derivative_data = json.loads((out / 'public/render-derivatives.json').read_text())['derivatives']
    served = []
    for view in accepted['views']:
        matches = [r for r in derivative_data if r['sourcePath'] == view['destination'] and r['sourceSha256'] == view['sourceSha256']]
        if len(matches) != 1 or any(matches[0][key] != view[key] for key in ('width', 'height')):
            raise Hold('served image differs from reviewed dimensions/source: ' + view['id'])
        served.append({'id': view['id'], **matches[0]})
    runtime_changes = []
    for file in public['files']:
        old = gallery / file['path']; old_hash = digest(old) if old.is_file() else None
        if old_hash != file['sha256']:
            runtime_changes.append({'path': file['path'], 'beforeSha256': old_hash, 'afterSha256': file['sha256']})
            patch = out / 'changed-assets' / file['path']; patch.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(out / 'public' / file['path'], patch)
    completed = time.perf_counter()
    report = {'schema': 1, 'status': 'LOCAL_PREPARED', 'galleryHead': checks['head'], 'targetHead': checks['targetHead'], 'remoteTipVerified': checks['remoteTipVerified'], 'acceptedManifestSha256': digest(accepted_path), 'acceptedAt': accepted['acceptedAt'], 'publicDirectory': 'public', 'publicManifestSha256': digest(out / 'public/public-manifest.json'), 'servedImages': served, 'changes': runtime_changes, 'acceptedSourceChanges': changes, 'catalogue': {k: v for k, v in checks.items() if k.startswith('catalogue') or k == 'requiredIds'}, 'timing': {'prepareStartedAt': wall, 'preparedAt': now(), 'acceptedToPrepareStartSeconds': (timestamp(wall)-timestamp(accepted['acceptedAt'])).total_seconds(), 'preflightSeconds': checked-started, 'copyStageSeconds': staged-checked, 'buildEncodeSeconds': public['buildSeconds'], 'postflightSeconds': completed-staged-public['buildSeconds'], 'prepareSeconds': completed-started, 'deploymentStartedAt': None, 'deploymentCompletedAt': None, 'readbackAcceptedAt': None, 'unmeasuredGaps': ['approved deployment queue/runtime', 'deployment to independent public acceptance']}, 'artifactBytes': public['artifactBytes'], 'deployment': {'status': 'NOT_STARTED', 'holds': [] if checks['remoteTipVerified'] else ['no remote main tip independently verified'], 'order': ['dedicated API catalogue update if required', 'independent catalogue ID readback', 'prepare against latest target revision', 'owner-approved gallery deployment', 'release.py readback']}}
    (out / 'release-manifest.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    return report

def main():
    parser = argparse.ArgumentParser(description=__doc__); sub = parser.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare'); prep.add_argument('--gallery', type=Path, required=True); prep.add_argument('--accepted-manifest', type=Path, required=True); prep.add_argument('--out', type=Path, required=True); prep.add_argument('--catalogue', type=Path); prep.add_argument('--chromium', type=Path)
    read = sub.add_parser('readback'); read.add_argument('--manifest', type=Path, required=True); read.add_argument('--base-url', required=True); read.add_argument('--chromium', type=Path); read.add_argument('--deployment-started-at'); read.add_argument('--deployment-completed-at')
    args = parser.parse_args()
    if args.chromium is None and os.environ.get('UNIT408_CHROMIUM'):
        args.chromium = Path(os.environ['UNIT408_CHROMIUM'])
    try:
        if args.command == 'prepare':
            result = prepare(args.gallery, args.accepted_manifest, args.out, args.catalogue, args.chromium)
            print(json.dumps({'status': result['status'], 'artifactBytes': result['artifactBytes'], 'prepareSeconds': result['timing']['prepareSeconds'], 'manifest': str(args.out / 'release-manifest.json')}))
        else:
            report = json.loads(args.manifest.read_text()); public = args.manifest.parent / report['publicDirectory'] / 'public-manifest.json'
            if digest(public) != report['publicManifestSha256']:
                raise Hold('prepared public manifest changed')
            cmd = ['node', str(Path(__file__).with_name('readback.mjs')), '--manifest', str(public), '--base-url', args.base_url]
            if args.chromium: cmd.extend(['--chromium', str(args.chromium)])
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            receipt = json.loads(result.stdout.strip().splitlines()[-1]); receipt['galleryHead'] = report['galleryHead']; receipt['acceptedAt'] = report['acceptedAt']; receipt['readbackAcceptedAt'] = now()
            receipt['deploymentStartedAt'] = args.deployment_started_at; receipt['deploymentCompletedAt'] = args.deployment_completed_at
            receipt['acceptedToReadbackSeconds'] = (timestamp(receipt['readbackAcceptedAt'])-timestamp(report['acceptedAt'])).total_seconds()
            receipt['unmeasuredGaps'] = [] if args.deployment_started_at and args.deployment_completed_at else ['deployment timestamps not supplied; no deployment runtime claim']
            receipt_path = args.manifest.with_name('readback-receipt.json')
            receipt_path.write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
            print(json.dumps({**{k: receipt[k] for k in ('status', 'files', 'verifiedBytes', 'renderedImages', 'browserRoutes', 'readbackSeconds', 'acceptedToReadbackSeconds')}, 'receipt': str(receipt_path)}))
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f'release HOLD: {exc}\n')
if __name__ == '__main__': main()
