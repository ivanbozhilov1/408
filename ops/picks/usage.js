/* Stable saved-design usage. Pure, serializable data; no names or fuzzy matching. */
(function(root) {
  'use strict';
  const SCHEMA = 'unit408-design-usage/1';
  const text = value => typeof value === 'string' ? value.trim() : '';
  const unique = values => [...new Set(values.filter(Boolean))].sort();
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const productParameter = key => /^(id|product_?id|pid|item_?id|goods_?id)$/i.test(key);
  const trackingParameter = key => /^(utm_.+|fbclid|gclid|srsltid|ref|referrer)$/i.test(key);

  function sourceIdentity(value) {
    if (!text(value)) return null;
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
      const path = url.pathname.replace(/\/+$/, '') || '/';
      url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
      url.pathname = path;
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) if (trackingParameter(key)) url.searchParams.delete(key);
      url.searchParams.sort();
      const exact = url.href;
      const productIds = [...url.searchParams].filter(([key, value]) => productParameter(key) && text(value));
      // A valid informational supplier URL is unresolved, unlike an unsafe or invalid URL.
      if (((path === '/' || /^\/(items?|products?|p|index\.(php|html?))$/i.test(path)) && !productIds.length) ||
          /^\/(search|collections?|categories|category|pages)(\/|$)/i.test(path) || /^\/[a-z]{2}\/[a-z]{2}$/i.test(path)) {
        return { model: '', exact, selectors: false, unresolved: true };
      }
      // The model is the supplier path plus explicit product IDs. Every other query
      // may change a variant or campaign, and must never establish a new model.
      const selectors = [...url.searchParams].some(([key]) => !productParameter(key));
      // Transport choice does not establish a different product on the same host.
      // Keep the original scheme in exact.
      url.protocol = 'https:';
      url.search = '';
      for (const [key, value] of productIds) url.searchParams.append(key, value);
      return { model: url.href, exact, selectors, unresolved: false };
    } catch { return null; }
  }

  function identity(product) {
    const p = product && typeof product === 'object' && !Array.isArray(product) ? product : {};
    const aliases = unique([text(p.id), text(p.originalId), ...(Array.isArray(p.legacyIds) ? p.legacyIds.map(text) : [])]);
    const suppliedSources = unique([text(p.source), text(p.url)]);
    const sources = suppliedSources.map(sourceIdentity).filter(Boolean);
    const models = unique(sources.map(s => s.model));
    const brand = text(p.brand || p.supplier).toLowerCase();
    const sku = text(p.sku);
    return {
      aliases, models, exactSources: unique(sources.filter(s => s.selectors).map(s => s.exact)),
      unresolvedSources: unique(sources.filter(s => s.unresolved).map(s => s.exact)),
      variant: text(p.variant).replace(/\s+/g, ' ').toLowerCase(),
      skuKey: brand && sku ? JSON.stringify([brand, sku]) : '',
      malformed: suppliedSources.length !== sources.length || models.length > 1 ||
        ['source','url'].some(key => p[key] != null && typeof p[key] !== 'string') ||
        (p.legacyIds != null && !Array.isArray(p.legacyIds))
    };
  }

  function href(designId, archival) {
    return (archival ? 'archive.html' : './') + '#design=' + encodeURIComponent(designId);
  }

  function build(designs) {
    const issues = [], appearances = [];
    if (!Array.isArray(designs)) issues.push('designs-not-array');
    const seenDesigns = new Set();
    for (const design of Array.isArray(designs) ? designs : []) {
      if (!design || !text(design.id) || !Array.isArray(design.products) || seenDesigns.has(design.id)) {
        issues.push('invalid-or-duplicate-design'); continue;
      }
      seenDesigns.add(design.id);
      for (const product of design.products) {
        if (!product || typeof product !== 'object' || Array.isArray(product)) { issues.push('invalid-product'); continue; }
        // Retained source records do not prove that a removed item appeared in this version.
        if (product.removedFromDesign) continue;
        const resolved = identity(product);
        if (resolved.malformed) issues.push('malformed-saved-product-identity');
        if (!resolved.aliases.length && !resolved.models.length && !resolved.skuKey) issues.push('unidentified-saved-product');
        appearances.push({
          designId: design.id,
          designLabel: [design.letter, design.name, design.version].map(text).filter(Boolean).join(' · ') || design.id,
          archival: Boolean(design.archival), href: href(design.id, Boolean(design.archival)),
          productId: text(product.id), identity: resolved
        });
      }
    }
    appearances.sort((a,b) => compare(a.designId,b.designId) || compare(a.productId,b.productId) || compare(JSON.stringify(a.identity),JSON.stringify(b.identity)));
    const coverage = {
      savedAppearances: appearances.length,
      modelResolvedAppearances: appearances.filter(a => a.identity.models.length === 1 && !a.identity.malformed).length,
      aliasOnlyAppearances: appearances.filter(a => !a.identity.models.length && a.identity.aliases.length).length,
      unresolvedSourceAppearances: appearances.filter(a => a.identity.unresolvedSources.length).length
    };
    const snapshot = { schema: SCHEMA, complete: issues.length === 0, issues: unique(issues), coverage, appearances };
    return { snapshot, lookup: product => lookup(snapshot, product) };
  }

  function validIdentity(value) {
    return value && ['aliases','models','exactSources','unresolvedSources'].every(key => Array.isArray(value[key]) && value[key].every(v => typeof v === 'string')) &&
      typeof value.variant === 'string' && typeof value.skuKey === 'string' && typeof value.malformed === 'boolean';
  }

  function validSnapshot(snapshot) {
    return Boolean(snapshot && snapshot.schema === SCHEMA && snapshot.complete === true &&
      Array.isArray(snapshot.issues) && snapshot.issues.length === 0 && Array.isArray(snapshot.appearances) &&
      snapshot.appearances.every(a => a && text(a.designId) && typeof a.designLabel === 'string' &&
        typeof a.archival === 'boolean' && a.href === href(a.designId, a.archival) &&
        typeof a.productId === 'string' && validIdentity(a.identity) && !a.identity.malformed));
  }

  const intersects = (left, right) => left.some(value => right.includes(value));
  function sameModel(a, b) {
    const direct = intersects(a.models, b.models);
    const alias = intersects(a.aliases, b.aliases) || Boolean(a.skuKey && a.skuKey === b.skuKey);
    const conflict = alias && a.models.length > 0 && b.models.length > 0 && !direct;
    return { matches: direct || (alias && !conflict), conflict };
  }

  function exactVariant(a, b) {
    if (a.malformed || b.malformed) return false;
    if (a.exactSources.length || b.exactSources.length) return intersects(a.exactSources, b.exactSources);
    if (a.skuKey && b.skuKey) return a.skuKey === b.skuKey;
    // An unspecified or placeholder variant never proves an exact match.
    return Boolean(a.variant && !/^(default title|default|exact specification \/ scope below|n\/?a|unknown)$/.test(a.variant) && a.variant === b.variant);
  }

  function lookup(snapshot, product) {
    const result = { identityKnown: false, eligibleUnused: false, productUses: [], exactVariantUses: [], issues: [] };
    if (!validSnapshot(snapshot)) { result.issues.push('invalid-usage-snapshot'); return result; }
    let candidate = identity(product);
    const productUses = new Map(), exactUses = new Map();
    result.identityKnown = candidate.models.length === 1 && !candidate.malformed;
    if (!snapshot.complete || snapshot.issues.length) result.issues.push('incomplete-usage-snapshot');
    if (candidate.malformed) result.issues.push('invalid-or-conflicting-source');
    const add = (map, appearance) => {
      if (!map.has(appearance.designId)) map.set(appearance.designId, {
        designId: appearance.designId, designLabel: appearance.designLabel, archival: appearance.archival,
        href: appearance.href, productIds: []
      });
      const use = map.get(appearance.designId);
      use.productIds = unique([...use.productIds, appearance.productId]);
    };
    const matches = [];
    for (const appearance of snapshot.appearances) {
      const match = sameModel(candidate, appearance.identity);
      if (match.conflict) result.issues.push('identity-source-conflict');
      if (!match.matches) continue;
      matches.push(appearance);
    }
    if (!candidate.models.length && unique(matches.flatMap(a => a.identity.models)).length > 1) {
      result.issues.push('ambiguous-product-alias');
      result.issues = unique(result.issues);
      return result;
    }
    // An explicit saved alias can resolve its one known model, then find every version.
    const resolvedModels = unique(matches.flatMap(a => a.identity.models));
    if (!candidate.models.length && resolvedModels.length === 1) {
      candidate = { ...candidate, models: resolvedModels };
      for (const appearance of snapshot.appearances) {
        if (!matches.includes(appearance) && sameModel(candidate, appearance.identity).matches) matches.push(appearance);
      }
      matches.sort((a,b) => compare(a.designId,b.designId) || compare(a.productId,b.productId));
    }
    for (const appearance of matches) {
      result.identityKnown = !candidate.malformed;
      add(productUses, appearance);
      if (exactVariant(candidate, appearance.identity)) add(exactUses, appearance);
    }
    result.productUses = [...productUses.values()];
    result.exactVariantUses = [...exactUses.values()];
    result.issues = unique(result.issues);
    result.eligibleUnused = result.identityKnown && !result.issues.length && !result.productUses.length;
    return result;
  }

  root.Unit408Usage = { build, lookup, validSnapshot };
})(globalThis);
