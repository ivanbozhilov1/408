"""Build a reachable public tree, never a repository archive. No network access."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

BASELINE_BYTES = 602_005_547
SUFFIXES = {'.html', '.js', '.css', '.json', '.png', '.webp', '.jpg', '.jpeg', '.svg', '.gif', '.avif', '.ico', '.csv', '.pdf', '.txt', '.woff', '.woff2', '.zip', '.7z', '.dwg', '.dxf', '.xlsx', '.docx', '.mp4', '.webm'}
TEXT = {'.html', '.js', '.css', '.json', '.svg', '.txt', '.csv'}
PRIVATE = re.compile(r'(^|/)(?:ops|\.git|\.github|private[^/]*|node_modules|reviews?)(/|$)|(?:auth\.json|review[^/]*\.json|candidate-check|unit408-regeneration|accepted-manifest|raw[-_]?export|build[-_]?logs?|preferences[-_](?:export|snapshot)|\.env|\.sqlite|\.db$|\.log$)', re.I)
SECRET = re.compile(r'(?:Bearer\s+[A-Za-z0-9._~-]{20,}|(?:[?#&](?:sync|token|access_token|key|edit|view)=)[A-Za-z0-9._~-]+|\b(?:sk-|ghp_)[A-Za-z0-9_-]{20,}|[\"\'](?:access[_-]?code|access[_-]?token|editor[_-]?(?:link|token)|viewer[_-]?(?:link|token)|bearer|token)[\"\']\s*:\s*[\"\'][A-Za-z0-9:/#?&=._~-]+[\"\'])', re.I)

def contains_secret(text):
    for _ in range(3):
        if SECRET.search(text):
            return True
        decoded = unquote(text)
        if decoded == text:
            break
        text = decoded
    return False

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.refs = []
    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if value and name in {'href', 'src', 'poster', 'data-src'}:
                self.refs.append(value)
            elif value and name == 'srcset':
                self.refs.extend(part.strip().split()[0] for part in value.split(','))

def resolve(root: Path, parent: Path, ref: str) -> Path | None:
    if not ref or ref.startswith(('#', 'data:', 'blob:', 'mailto:', 'tel:', 'javascript:')) or '${' in ref:
        return None
    if contains_secret(ref):
        raise ValueError(f'credential-like public reference in {parent.relative_to(root)}')
    url = urlsplit(ref)
    if url.scheme or url.netloc:
        return None
    value = unquote(url.path)
    if not value:
        return None
    if '\\' in value or '\x00' in value:
        raise ValueError(f'unsafe local reference in {parent.relative_to(root)}')
    if value.startswith('/bedroom-design-options/'):
        value = value[len('/bedroom-design-options/'):]
        target = root / value
    elif value.startswith('/'):
        target = root / value.lstrip('/')
    else:
        target = parent.parent / value
    target = target.resolve()
    if not target.is_relative_to(root):
        raise ValueError(f'unsafe traversal: {ref}')
    if target.is_dir() or value.endswith('/'):
        target = target / 'index.html'
    rel = target.relative_to(root).as_posix()
    if PRIVATE.search(rel) or any(part.startswith('.') for part in target.relative_to(root).parts):
        raise ValueError(f'private file referenced by public runtime: {rel}')
    if not target.is_file() or target.is_symlink():
        raise ValueError(f'missing or unsafe public reference: {parent.relative_to(root)} -> {ref}')
    if target.suffix.lower() not in SUFFIXES:
        raise ValueError(f'unsupported public download/runtime type: {rel}')
    return target

def strings(value, key=''):
    # Provenance hashes/paths are metadata, not downloads. Explicit HTML links always count.
    if key in {'sourceImage', 'sourcePath'}:
        return
    if isinstance(value, dict):
        for k, v in value.items():
            yield from strings(v, k)
    elif isinstance(value, list):
        for v in value:
            yield from strings(v, key)
    elif key not in {'label', 'name', 'caption', 'description', 'summary', 'note', 'notes'} and isinstance(value, str) and re.search(r'\.(?:html|js|css|json|png|webp|jpe?g|svg|gif|avif|ico|csv|pdf|woff2?)(?:[?#].*)?$', value, re.I):
        yield value

def references(file: Path, text: str):
    if file.suffix == '.json':
        yield from strings(json.loads(text))
    if file.suffix == '.html':
        parser = Links(); parser.feed(text); yield from parser.refs
    if file.suffix in {'.html', '.js', '.css', '.svg'}:
        yield from re.findall(r'url\(\s*[\'\"]?([^\'\")]+)', text)
        yield from re.findall(r'fetch\(\s*[\'\"]([^\'\"]+)[\'\"]', text)
        # Static fetch/import literals and embedded public data. Dynamic values resolve in-browser.
        for quote, ref in re.findall(r'([\'\"])([^\'\"\n]+?)\1', text):
            if re.fullmatch(r'[^<>\s{}]+\.(?:js|css|png|webp|jpe?g|svg|gif|avif|ico|woff2?)(?:[?#].*)?', ref, re.I):
                yield ref

def reachable(root: Path) -> set[Path]:
    root = root.resolve()
    # Every HTML route is a public entrypoint, including hidden archives and legacy boards.
    todo = [p for p in root.rglob('*.html') if not PRIVATE.search(p.relative_to(root).as_posix()) and not any(x.startswith('.') for x in p.relative_to(root).parts)]
    if not todo:
        raise ValueError('no public HTML routes')
    seen = set()
    while todo:
        file = todo.pop()
        if file in seen:
            continue
        if file.is_symlink() or not file.resolve().is_relative_to(root):
            raise ValueError(f'unsafe public file: {file.name}')
        seen.add(file)
        if file.suffix.lower() in TEXT:
            text = file.read_text(encoding='utf-8-sig')
            if contains_secret(text):
                raise ValueError(f'credential-like content in {file.relative_to(root)}')
            for ref in references(file, text):
                target = resolve(root, file, ref)
                if target and target not in seen:
                    todo.append(target)
    if (root / '.nojekyll').is_file():
        seen.add(root / '.nojekyll')
    return seen

def build(gallery: Path, out: Path, *, encode=True, chromium=None, cache_dir=None, encoder_script=None) -> dict:
    gallery = gallery.resolve(); out = out.resolve()
    if out.exists() or out.is_relative_to(gallery):
        raise ValueError('output must be a fresh directory outside the gallery')
    start = time.perf_counter(); inputs = reachable(gallery)
    encoded = None
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='unit408-public-', dir=out.parent) as temporary:
        scratch = Path(temporary)
        for file in inputs:
            dest = scratch / file.relative_to(gallery); dest.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(file, dest)
            # An already-served WebP may have a retained original PNG required for safe re-encoding.
            if encode and file.suffix == '.webp' and file.with_suffix('.png').is_file():
                shutil.copyfile(file.with_suffix('.png'), dest.with_suffix('.png'))
        if encode:
            old = gallery / 'render-derivatives.json'
            if old.is_file():
                shutil.copyfile(old, scratch / old.name)
                for record in json.loads(old.read_text())['derivatives']:
                    source = resolve(gallery, gallery / 'collection-data.json', record['sourcePath'])
                    dest = scratch / source.relative_to(gallery); dest.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, dest)
            cmd = ['node', str(encoder_script or gallery / 'ops/images/webp_views.mjs'), str(scratch)]
            if chromium:
                cmd.extend(['--chromium', str(chromium)])
            if cache_dir:
                cmd.extend(['--cache-dir', str(cache_dir)])
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode:
                raise ValueError('render derivative encoder failed: ' + result.stderr[-1800:])
            encoded = json.loads(result.stdout.strip().splitlines()[-1])
        final = reachable(scratch)
        derivatives = scratch / 'render-derivatives.json'
        if derivatives.is_file():
            final.add(derivatives)
        out.mkdir()
        entries = []
        for file in sorted(final):
            rel = file.relative_to(scratch); dest = out / rel; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(file, dest)
            entries.append({'path': rel.as_posix(), 'sha256': digest(dest), 'bytes': dest.stat().st_size})
    total = sum(e['bytes'] for e in entries)
    manifest = {'schema': 1, 'policy': 'all-html-routes-and-reachable-runtime-v1; provenance paths excluded unless explicitly linked; originals retained in source repository', 'files': entries, 'bytes': total, 'baselineBytes': BASELINE_BYTES, 'reductionPercent': round((1-total/BASELINE_BYTES)*100, 3), 'buildSeconds': time.perf_counter()-start, 'encoding': encoded}
    (out / 'public-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    manifest['artifactBytes'] = total + (out / 'public-manifest.json').stat().st_size
    return manifest

def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--gallery', type=Path, required=True); parser.add_argument('--out', type=Path, required=True); parser.add_argument('--chromium', type=Path); parser.add_argument('--cache-dir', type=Path)
    args = parser.parse_args()
    try:
        result = build(args.gallery, args.out, chromium=args.chromium, cache_dir=args.cache_dir)
        print(json.dumps({k: result[k] for k in ('bytes', 'artifactBytes', 'baselineBytes', 'reductionPercent', 'buildSeconds', 'encoding')}))
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f'public artifact HOLD: {exc}\n')
if __name__ == '__main__':
    main()
