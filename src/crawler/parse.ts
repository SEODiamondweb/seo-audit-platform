import { load } from 'cheerio';
import { collapseWhitespace, countWords, shortHash } from '../utils/text';
import { safeParseUrl } from '../utils/url';
import { analyzeContent } from '../content';
import type { ContentAnalysis, Heading } from '../content';
import type {
  HreflangRef,
  ImageRef,
  LinkRef,
  StructuredDataBlock,
  StructuredDataEntity,
} from './types';

/** Contenitori che non fanno parte del contenuto proprio della pagina. */
const BOILERPLATE_SELECTORS = [
  'nav',
  'header',
  'footer',
  'aside',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="dialog"]',
].join(', ');

/** Sottostringhe di class o id che identificano banner cookie, menù e widget di contorno. */
const BOILERPLATE_MARKERS = [
  'cookie',
  'consent',
  'cmplz',
  'iubenda',
  'cybotcookiebot',
  'privacy-banner',
  'gdpr',
  'breadcrumb',
  'site-header',
  'site-footer',
  'main-menu',
  'menu-toggle',
  'skip-link',
  'post-meta',
  'entry-meta',
  'entry-footer',
  'byline',
  'vcard',
  'social-share',
  'sharedaddy',
  'related-post',
  'comment-',
  'pagination',
  'widget',
];

export interface ParsedPage {
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2: string[];
  content: ContentAnalysis;
  canonical: string | null;
  metaRobots: string | null;
  hreflang: HreflangRef[];
  lang: string | null;
  wordCount: number;
  textRatio: number;
  images: ImageRef[];
  links: LinkRef[];
  structuredData: StructuredDataBlock[];
  hasViewport: boolean;
  ogTitle: string | null;
  ogImage: string | null;
  mixedContent: string[];
  contentHash: string;
  baseHref: string | null;
}

/** Raccoglie ricorsivamente tutti i valori @type di un blocco JSON-LD. */
function collectTypes(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 8 || node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, out, depth + 1);
    return;
  }

  const record = node as Record<string, unknown>;
  const type = record['@type'];
  if (typeof type === 'string') {
    out.add(type);
  } else if (Array.isArray(type)) {
    for (const t of type) if (typeof t === 'string') out.add(t);
  }

  for (const key of Object.keys(record)) {
    if (key === '@type') continue;
    collectTypes(record[key], out, depth + 1);
  }
}


/**
 * Raccoglie le entita di un blocco JSON-LD: tipo, proprieta dichiarate e presenza di @id.
 *
 * Serve a validare oltre la sintassi: un Article senza author, un Product senza offers o un
 * grafo di entita senza @id sono markup formalmente validi ma inutili ai rich result.
 */
function collectEntities(node: unknown, out: StructuredDataEntity[], depth = 0): void {
  if (depth > 8 || node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) collectEntities(item, out, depth + 1);
    return;
  }

  const record = node as Record<string, unknown>;
  const rawType = record['@type'];
  const types = typeof rawType === 'string' ? [rawType] : Array.isArray(rawType) ? rawType : [];

  for (const type of types) {
    if (typeof type !== 'string') continue;
    out.push({
      type,
      properties: Object.keys(record).filter((k) => !k.startsWith('@')),
      hasId: typeof record['@id'] === 'string',
    });
  }

  for (const key of Object.keys(record)) {
    collectEntities(record[key], out, depth + 1);
  }
}

const REQUIRED_PROPERTIES: Record<string, string[]> = {
  Product: ['name'],
  Article: ['headline'],
  NewsArticle: ['headline'],
  BlogPosting: ['headline'],
  Organization: ['name'],
  LocalBusiness: ['name'],
  BreadcrumbList: ['itemListElement'],
  FAQPage: ['mainEntity'],
  Event: ['name', 'startDate'],
  Recipe: ['name'],
  JobPosting: ['title', 'datePosted', 'hiringOrganization'],
};

/**
 * Validazione strutturale minima del JSON-LD: presenza di @context/@type e delle
 * proprietà obbligatorie dei tipi più comuni. Non sostituisce il Rich Results Test,
 * ma intercetta gli errori che bloccano davvero l’eleggibilità ai rich result.
 */
function validateJsonLd(node: unknown, errors: string[], path = '$'): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => validateJsonLd(item, errors, path + '[' + i + ']'));
    return;
  }
  if (node === null || typeof node !== 'object') return;

  const record = node as Record<string, unknown>;

  if (Array.isArray(record['@graph'])) {
    validateJsonLd(record['@graph'], errors, path + '.@graph');
    return;
  }

  if (!record['@type']) {
    errors.push(path + ': manca la proprietà @type');
  }
  if (path === '$' && !record['@context']) {
    errors.push(path + ': manca la proprietà @context');
  }

  const type = typeof record['@type'] === 'string' ? (record['@type'] as string) : '';
  for (const prop of REQUIRED_PROPERTIES[type] ?? []) {
    const value = record[prop];
    if (value === undefined || value === null || value === '') {
      errors.push(path + ' (' + type + '): manca la proprietà obbligatoria "' + prop + '"');
    }
  }
}

export function parseHtml(html: string, pageUrl: string): ParsedPage {
  const $ = load(html);

  const baseHrefAttr = $('base[href]').first().attr('href');
  const baseHref = baseHrefAttr ? baseHrefAttr.trim() : null;
  const resolveBase = baseHref
    ? safeParseUrl(baseHref, pageUrl)?.toString() ?? pageUrl
    : pageUrl;

  const rawTitle = $('head title').first().text();
  const rawDescription = $('meta[name="description"]').first().attr('content');
  const rawCanonical = $('link[rel="canonical"]').first().attr('href');

  const metaRobots = $('meta[name="robots"], meta[name="googlebot"]')
    .map((_, el) => $(el).attr('content') ?? '')
    .get()
    .filter((value) => value !== '')
    .join(', ');

  // Heading H1-H6 in ordine di documento: serve la sequenza, non i gruppi per livello,
  // perché è l'ordine a rivelare i salti di gerarchia (un H2 seguito da un H4).
  const headings: Heading[] = $('h1, h2, h3, h4, h5, h6')
    .map((_, el) => ({
      level: Number.parseInt((el as { tagName?: string }).tagName?.slice(1) ?? '1', 10) || 1,
      text: collapseWhitespace($(el).text()),
    }))
    .get();

  const h1 = headings.filter((h) => h.level === 1 && h.text !== '').map((h) => h.text);
  const h2 = headings.filter((h) => h.level === 2 && h.text !== '').map((h) => h.text);

  const hreflang: HreflangRef[] = $('link[rel="alternate"][hreflang]')
    .map((_, el) => ({
      lang: ($(el).attr('hreflang') ?? '').trim(),
      href: ($(el).attr('href') ?? '').trim(),
    }))
    .get()
    .filter((entry: HreflangRef) => entry.lang !== '');

  const images: ImageRef[] = $('img')
    .map((_, el) => {
      const $el = $(el);
      const rawSrc = (
        $el.attr('src') ||
        $el.attr('data-src') ||
        $el.attr('data-lazy-src') ||
        ''
      ).trim();
      const alt = $el.attr('alt');
      return {
        src: rawSrc ? safeParseUrl(rawSrc, resolveBase)?.toString() ?? rawSrc : '',
        alt: alt === undefined ? null : alt,
        hasAltAttribute: alt !== undefined,
        width: $el.attr('width') ?? null,
        height: $el.attr('height') ?? null,
        loading: $el.attr('loading') ?? null,
      };
    })
    .get()
    .filter((img: ImageRef) => img.src !== '');

  const links: LinkRef[] = [];
  $('a[href]').each((_, el) => {
    const $el = $(el);
    const href = ($el.attr('href') ?? '').trim();
    if (!href || href.startsWith('#')) return;
    if (/^(mailto|tel|javascript|data|sms|whatsapp):/i.test(href)) return;

    const resolved = safeParseUrl(href, resolveBase);
    if (!resolved) return;

    const rel = $el.attr('rel') ?? null;
    links.push({
      url: resolved.toString(),
      anchor: collapseWhitespace($el.text()).slice(0, 200),
      rel,
      nofollow: rel !== null && /\bnofollow\b/i.test(rel),
    });
  });

  const structuredData: StructuredDataBlock[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;

    const types = new Set<string>();
    const entities: StructuredDataEntity[] = [];
    const errors: string[] = [];
    try {
      const json = JSON.parse(raw) as unknown;
      collectTypes(json, types);
      collectEntities(json, entities);
      validateJsonLd(json, errors);
      if (types.size === 0) errors.push('Blocco JSON-LD privo di @type');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push('JSON-LD non parsabile: ' + message);
    }
    structuredData.push({ format: 'json-ld', types: [...types], entities, errors });
  });

  const microdataTypes = new Set<string>();
  $('[itemtype]').each((_, el) => {
    const itemtype = ($(el).attr('itemtype') ?? '').trim();
    const name = itemtype.split('/').pop();
    if (name) microdataTypes.add(name);
  });
  if (microdataTypes.size > 0) {
    structuredData.push({
      format: 'microdata',
      types: [...microdataTypes],
      entities: [...microdataTypes].map((type) => ({ type, properties: [], hasId: false })),
      errors: [],
    });
  }

  const rdfaTypes = new Set<string>();
  $('[typeof]').each((_, el) => {
    const value = ($(el).attr('typeof') ?? '').trim();
    if (value) rdfaTypes.add(value.split(/\s+/)[0] as string);
  });
  if (rdfaTypes.size > 0) {
    structuredData.push({
      format: 'rdfa',
      types: [...rdfaTypes],
      entities: [...rdfaTypes].map((type) => ({ type, properties: [], hasId: false })),
      errors: [],
    });
  }

  const mixedContent: string[] = [];
  if (pageUrl.startsWith('https://')) {
    $('img[src], script[src], link[href], iframe[src], video[src], audio[src], source[src]').each(
      (_, el) => {
        const $el = $(el);
        const value = ($el.attr('src') ?? $el.attr('href') ?? '').trim();
        if (/^http:\/\//i.test(value) && mixedContent.length < 20) mixedContent.push(value);
      },
    );
  }

  const $body = $('body').clone();
  $body.find('script, style, noscript, template, svg, iframe').remove();

  // Il testo di elementi adiacenti va separato esplicitamente. Servono entrambi i lati:
  // <span>2018</span><a>Leggi</a> richiede lo spazio prima, </p>Indice dell articolo lo
  // richiede dopo, perche li il testo e un nodo nudo che segue un elemento. Senza, si
  // ottengono termini inesistenti come 2018leggi o newsindice.
  $body.find('*').before(' ').after(' ');

  const bodyText = collapseWhitespace($body.text());

  // Per l'analisi semantica serve il contenuto proprio della pagina, non quello di contorno.
  // Menù, header, footer e banner cookie sono identici su tutto il sito: lasciandoli dentro,
  // l'argomento rilevato finisce per essere il testo dell'informativa privacy anziché quello
  // dell'articolo. Qui si toglie il contorno strutturale; la ripetizione fra pagine viene
  // filtrata dopo il crawl in refineKeywords().
  const $main = $body.clone();
  $main.find(BOILERPLATE_SELECTORS).remove();
  $main
    .find('[class], [id]')
    .filter((_, el) => {
      const $el = $(el);
      const marker = (($el.attr('class') ?? '') + ' ' + ($el.attr('id') ?? '')).toLowerCase();
      return BOILERPLATE_MARKERS.some((needle) => marker.includes(needle));
    })
    .remove();

  const mainText = collapseWhitespace($main.text());
  // Se togliendo il contorno resta quasi nulla, la pagina è fatta solo di elementi strutturali:
  // meglio ricadere sul testo completo che analizzare tre parole.
  const analysisText = mainText.length >= 200 ? mainText : bodyText;
  // I paragrafi vanno contati sullo stesso testo che viene analizzato, altrimenti la lunghezza
  // media risulta falsata. Contano solo quelli con del testo: i <p> vuoti usati come spaziatori
  // dai page builder gonfierebbero il denominatore.
  const $paragraphSource = analysisText === mainText ? $main : $body;
  const paragraphs = $paragraphSource
    .find('p')
    .filter((_, el) => $(el).text().trim().length > 0).length;

  const ogTitle = $('meta[property="og:title"]').first().attr('content');
  const ogImage = $('meta[property="og:image"]').first().attr('content');
  const htmlLang = $('html').attr('lang');
  const title = rawTitle ? collapseWhitespace(rawTitle) : null;
  const metaDescription =
    rawDescription !== undefined ? collapseWhitespace(rawDescription) : null;

  const content = analyzeContent({
    bodyText: analysisText,
    paragraphs,
    headings,
    title,
    description: metaDescription,
    url: pageUrl,
    imageAlts: images.map((img) => img.alt ?? '').filter((alt) => alt !== ''),
  });

  return {
    title,
    metaDescription,
    h1,
    h2,
    content,
    canonical: rawCanonical ? rawCanonical.trim() : null,
    metaRobots: metaRobots !== '' ? metaRobots : null,
    hreflang,
    lang: htmlLang ? htmlLang.trim() : null,
    wordCount: countWords(bodyText),
    textRatio: html.length > 0 ? bodyText.length / html.length : 0,
    images,
    links,
    structuredData,
    hasViewport: $('meta[name="viewport"]').length > 0,
    ogTitle: ogTitle ? ogTitle.trim() : null,
    ogImage: ogImage ? ogImage.trim() : null,
    mixedContent,
    contentHash: shortHash(bodyText.slice(0, 20000).toLowerCase()),
    baseHref,
  };
}
