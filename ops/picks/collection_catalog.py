"""Build the combined catalogue without renaming existing shared item IDs."""
import json
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
BOARDS = ('def', 'ghi', 'jkl', 'mno')
LATER_BOARDS = ('stu',)  # sets published after the combined catalogue; read when their folder exists
FIELDS = ('role', 'name', 'brand', 'sku', 'variant', 'family', 'url', 'scope', 'materials', 'dimensions')
ROLES = {
    'bedside': 'nightstand', 'bedside table': 'nightstand',
    'closed-storage bedside cabinet': 'nightstand', 'bedside_lamp': 'lamp',
    'bed frame': 'bed', 'compact tv console': 'console', 'wall mirror': 'mirror',
    'armchair with armrests': 'chair', 'armchair with padded wraparound armrests': 'chair',
    'armchair with upholstered wraparound arms': 'chair', 'wall-art': 'art',
    'potted-plant': 'plant', 'plant_with_pot': 'plant', 'pot': 'planter',
    'bedcover': 'bedspread', 'pillowcase': 'sleeping_pillowcase',
    'pillowcases': 'sleeping_pillowcase', 'sleeping-pillowcase': 'sleeping_pillowcase',
    'owner-photo-frame': 'decor', 'personal_frame': 'decor', 'personal_frames': 'decor',
    'frame': 'decor', 'equipment and fixtures': 'technical',
}
KNOWN = {'bed', 'nightstand', 'chair', 'console', 'lamp', 'ceiling', 'mirror', 'rug',
         'plant', 'stems', 'planter', 'decor', 'art', 'basket', 'tray', 'candle_holder',
         'accent_cushion_cover', 'bedspread', 'throw', 'sleeping_pillowcase',
         'sleeping_pillowcase_pack', 'bedding_insert', 'ceiling_cord', 'valance_led', 'technical'}

def build(root=ROOT):
    original = {}
    for board in BOARDS + tuple(b for b in LATER_BOARDS if (root / b / 'data/designs.json').exists()):
        folder = root if board == 'def' else root / board
        source = json.loads((folder / 'data/designs.json').read_text(encoding='utf-8'))
        for product in source['items']:
            original[board + ':' + product['id']] = product
    collection = json.loads((root / 'collection-data.json').read_text(encoding='utf-8'))
    entries = {}
    mapping = {}
    for design in collection['designs']:
        for product in design['products']:
            local_id = product['id']
            candidates = [value for value in product.get('legacyIds', []) if value in original]
            candidates = list(dict.fromkeys(candidates))
            if len(candidates) > 1:
                raise ValueError('Ambiguous legacy identity: ' + local_id)
            wire_id = candidates[0] if candidates else local_id
            if local_id in mapping and mapping[local_id] != wire_id:
                raise ValueError('Inconsistent identity: ' + local_id)
            mapping[local_id] = wire_id
            if wire_id in entries:
                previous = entries[wire_id]
                if previous['localId'] != local_id:
                    raise ValueError('Two collection IDs share one wire ID: ' + wire_id)
                if design['id'] not in previous['designIds']:
                    previous['designIds'].append(design['id'])
                continue
            if candidates:
                metadata = {key: original[wire_id][key] for key in FIELDS if key in original[wire_id]}
                board = wire_id.split(':', 1)[0]
            else:
                category = (product.get('category') or '').lower().strip()
                role = ROLES.get(category, category if category in KNOWN else '')
                metadata = {
                    'name': product['name'], 'role': role, 'category': role or 'unknown',
                    'url': product.get('source') or '', 'variant': product.get('variant') or '',
                    'brand': product.get('brand') or '', 'sku': product.get('sku') or '',
                    'family': product.get('family') or '', 'materials': product.get('materials') or '',
                    'scope': product.get('scope') or '', 'dimensions': product.get('dimensions') or '',
                }
                board = design['namespace']
            entries[wire_id] = {
                'id': wire_id, 'localId': local_id, 'designId': design['id'], 'designIds': [design['id']],
                'board': board, 'label': design['author'] + ' · ' + design['letter'] + ' · ' + design['name'],
                'name': product['name'], 'url': '/bedroom-design-options/#design=' + quote(design['id'], safe=''),
                'product': metadata,
            }
    old_ids = json.loads((root / 'ops/picks/catalog.json').read_text(encoding='utf-8'))
    # Keep any already permitted historical ID even if a future display model omits it.
    all_ids = list(dict.fromkeys(old_ids + list(entries)))
    if not set(original) <= set(entries):
        raise ValueError('The collection is missing existing Fable identities')
    if any(not isinstance(value, str) or not 1 <= len(value) <= 256 for value in all_ids):
        raise ValueError('Invalid API item ID')
    payload = {'schema': 1, 'items': list(entries.values())}
    (root / 'collection-catalog.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (root / 'ops/picks/catalog.json').write_text(json.dumps(all_ids, indent=2) + '\n', encoding='utf-8')
    return {'items': len(entries), 'allowedIds': len(all_ids), 'legacyIds': len(original),
            'designs': len(collection['designs']), 'unknownCategoryItems': sum(not x['product'].get('role') for x in entries.values())}

if __name__ == '__main__':
    print(json.dumps(build()))
