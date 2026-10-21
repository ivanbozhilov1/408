"""Add shared-picks behavior without rebuilding or replacing render assets."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from html import unescape
from pathlib import Path

BEGIN = '// BEGIN UNIT408 SHARED PICKS\n'
END = '// END UNIT408 SHARED PICKS\n'


def patch(gallery: Path, endpoint: str, catalog_path: Path) -> list[str]:
    pages = sorted(gallery.glob('**/index.html'))
    legacy_root = gallery / 'fable-def.html'
    if legacy_root.exists():
        # The unified collection has its own runtime; preserve its root page.
        # The DEF schedule retains its existing IDs at this compatibility route.
        pages = [legacy_root if page == gallery / 'index.html' else page for page in pages]
    pages = [page for page in pages if '.git' not in page.parts and (page.parent / 'site.js').exists()]
    catalog = []
    boards = {}
    for page in pages:
        board = page.parent.relative_to(gallery).as_posix()
        board = 'def' if board == '.' else board
        if not re.fullmatch('[a-z]{3}', board):
            raise ValueError(f'Unsupported gallery folder: {board}')
        boards[page] = board
        data_path = page.parent / 'data' / 'designs.json'
        product_data = json.loads(data_path.read_text(encoding='utf-8')) if data_path.exists() else {}
        products = {item['id']: item for item in product_data.get('items', [])}
        content = page.read_text(encoding='utf-8')
        label = re.search(r'<title>(.*?)</title>', content).group(1)
        label = unescape(label).replace('Unit 408 — ', '')
        for row in re.finditer(r'<tr\b[^>]*data-item-id="([^"]+)"[^>]*>(.*?)</tr>', content, re.S):
            name = re.search(r'class="piece-name"[^>]*>(.*?)</', row[2], re.S)
            if not name:
                raise ValueError(f'Missing item name: {board}:{row[1]}')
            item_id = unescape(row[1])
            catalog.append({'id': f'{board}:{item_id}', 'board': board, 'label': label,
                            'name': unescape(re.sub('<[^>]+>', '', name[1])),
                            'url': '/bedroom-design-options/' + (('fable-def.html' if legacy_root.exists() else '') if board == 'def' else board + '/') + '?shared-picks=1#row-' + item_id,
                            'product': {key: value for key, value in products.get(item_id, {}).items()
                                        if key in ('id', 'role', 'name', 'brand', 'sku', 'variant', 'family', 'url', 'scope', 'materials', 'dimensions')}})
    if not catalog or len({item['id'] for item in catalog}) != len(catalog):
        raise ValueError('Catalogue is empty or contains duplicate IDs')
    template = Path(__file__).with_name('client.js').read_text(encoding='utf-8')
    engine = Path(__file__).with_name('preferences.js').read_text(encoding='utf-8')
    for page, board in boards.items():
        script_path = page.parent / 'site.js'
        script = script_path.read_text(encoding='utf-8')
        script = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END), '', script, flags=re.S)
        if 'window.unit408Picks = ' not in script:
            anchors = [
                ('  let picked = load();', '  let picked = load(), readOnly = false, externallyManaged = false;'),
                ('  const importHash = () => {', '  const importHash = () => {\n    if (externallyManaged) return false;'),
                ('  function render() {', '  function render() {\n    document.querySelector("[data-picks-clear]").disabled = readOnly;'),
                ("button.setAttribute('aria-pressed', String(on));", "button.disabled = readOnly; button.setAttribute('aria-pressed', String(on));"),
                ('    text.value = plain(filled);', '    list.querySelectorAll("[data-pick]").forEach(button => {button.disabled = readOnly;});\n    text.value = plain(filled);'),
                ('    if (!button) return;', '    if (!button || readOnly) return;'),
                ("    save(); render(); setStatus('');", "    save(); render(); setStatus('');\n    window.dispatchEvent(new CustomEvent('unit408:picks-change', {detail: [{id, starred: picked.has(id)}]}));"),
                ("    if (!picked.size || !confirm('Remove all starred pieces?')) return;", "    if (readOnly || !picked.size || !confirm('Remove all starred pieces?')) return;\n    const removed = [...picked];"),
                ("    picked.clear(); save(); render(); setStatus('All stars removed.');", "    picked.clear(); save(); render(); setStatus('All stars removed.');\n    window.dispatchEvent(new CustomEvent('unit408:picks-change', {detail: removed.map(id => ({id, starred:false}))}));"),
                ('  const reveal = () =>', '  window.unit408Picks = {get: () => [...picked], set: ids => {picked = new Set(ids.filter(id => rows.has(id))); render();}, readonly: value => {readOnly = value; render();}, managed: value => {externallyManaged = value;}, restore: () => {picked = load(); render();}};\n  const reveal = () =>'),
            ]
            for old, new in anchors:
                if script.count(old) != 1:
                    raise ValueError(f'Expected one runtime anchor {old!r} in {script_path}')
                script = script.replace(old, new, 1)
        client = template.replace('__PICKS_API__', json.dumps(endpoint)).replace('__PICKS_CATALOG__', json.dumps(catalog, ensure_ascii=False)).replace('__PICKS_BOARD__', json.dumps(board))
        combined = script.rstrip() + '\n\n' + BEGIN + engine + '\n' + client + END
        script_path.write_text(combined, encoding='utf-8')
        version = hashlib.sha256(combined.encode('utf-8')).hexdigest()[:12]
        content = page.read_text(encoding='utf-8')
        origin = endpoint.split('/api/')[0]
        content = re.sub(r"; connect-src [^;\"]+", '', content)
        content = content.replace("script-src 'self';", f"script-src 'self'; connect-src 'self' {origin};")
        content = re.sub(r'src="site\.js(?:\?[^\"]*)?"', f'src="site.js?v={version}"', content)
        content = re.sub(r'href="site\.css(?:\?[^\"]*)?"', f'href="site.css?v={version}"', content)
        page.write_text(content, encoding='utf-8')
        css_path = page.parent / 'site.css'
        css = css_path.read_text(encoding='utf-8')
        marker = '/* UNIT408 SHARED PICKS */'
        if marker not in css:
            css += '\n' + marker + '\n.picks-sync{border:1px solid var(--line,#d8d2c7);padding:1rem;margin:1rem 0;overflow-wrap:anywhere}.picks-sync p{margin:.5rem 0}.picks-sync button,.picks-sync input{font:inherit;min-height:44px;padding:.55rem .8rem;max-width:100%}.picks-sync label{display:block;margin:.75rem 0}.picks-sync input{display:block;width:100%;box-sizing:border-box}.picks-sync ul{padding-left:1.25rem}.picks-sync li{margin:.5rem 0}.picks-sync [hidden]{display:none!important}.pick:disabled{cursor:default;opacity:.65}\n'
        exclusion_marker = '/* UNIT408 EXCLUSIONS */'
        css = css.split(exclusion_marker)[0].rstrip()
        css += '\n' + exclusion_marker + '\n' + (
            '.exclude-item{display:block;margin-top:.5rem;min-height:44px;padding:.45rem .65rem;font:inherit}'
            '[data-exclusion-state]{display:block;max-width:15rem;margin-top:.4rem;color:#7c3425}'
            '.item-excluded{background:#fff2e9}.exclusion-dialog{max-width:36rem;width:calc(100% - 2rem);box-sizing:border-box;max-height:90vh;overflow:auto;border:1px solid #857565;border-radius:.6rem;padding:1.25rem}'
            '.exclusion-dialog::backdrop{background:#0007}.exclusion-dialog label{display:block;margin:.7rem 0}'
            '.exclusion-dialog textarea{box-sizing:border-box;width:100%;font:inherit}.exclusion-dialog button{font:inherit;min-height:44px;padding:.55rem .8rem;margin:.25rem 0}'
            '.exclusion-dialog input{width:1.2rem;height:1.2rem;vertical-align:middle}'
            '.picks-sync [data-exclusions] button{margin:.25rem}.picks-sync button:disabled{opacity:.65}\n')
        css_path.write_text(css, encoding='utf-8')
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(json.dumps([item['id'] for item in catalog], indent=2) + '\n', encoding='utf-8')
    return list(boards.values())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('gallery', type=Path)
    parser.add_argument('--api', required=True)
    parser.add_argument('--catalog', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps({'patchedBoards': patch(args.gallery, args.api, args.catalog)}))
