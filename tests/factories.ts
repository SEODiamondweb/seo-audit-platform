import type { CrawlConfig, CrawlResult, CrawledUrl } from '../src/crawler/types';

export function makeConfig(overrides: Partial<CrawlConfig> = {}): CrawlConfig {
  return {
    startUrl: 'https://example.com/',
    maxUrls: 500,
    maxDepth: 10,
    concurrency: 5,
    delayMs: 0,
    timeoutMs: 15000,
    respectRobots: true,
    includeSubdomains: false,
    userAgent: 'test-agent',
    include: [],
    exclude: [],
    ...overrides,
  };
}

export function makePage(overrides: Partial<CrawledUrl> = {}): CrawledUrl {
  const url = overrides.url ?? 'https://example.com/';
  return {
    url,
    finalUrl: url,
    statusCode: 200,
    statusText: 'OK',
    contentType: 'text/html; charset=utf-8',
    isHtml: true,

    indexable: true,
    indexabilityStatus: 'Indexable',

    title: 'Titolo di prova sufficientemente lungo',
    titleLength: 38,
    metaDescription: 'Una meta description di prova con una lunghezza ragionevole per i test automatici.',
    metaDescriptionLength: 82,
    h1: ['Titolo principale'],
    h2: ['Sezione uno', 'Sezione due'],

    canonical: url,
    canonicalResolved: url,
    isSelfCanonical: true,

    metaRobots: null,
    xRobotsTag: null,
    noindex: false,
    nofollowPage: false,

    hreflang: [],
    lang: 'it',

    wordCount: 800,
    textRatio: 0.3,

    depth: 0,
    inlinks: 5,
    uniqueInlinks: 5,
    linkedFrom: [],
    outlinks: 20,
    externalOutlinks: 2,
    nofollowOutlinks: 0,
    internalLinks: [],
    externalLinks: [],

    redirectChain: [],
    redirectTarget: null,
    redirectLoop: false,

    responseTimeMs: 300,
    sizeBytes: 50000,

    images: [],
    imagesMissingAlt: 0,

    structuredData: [
      {
        format: 'json-ld',
        types: ['WebPage'],
        entities: [{ type: 'WebPage', properties: ['name', 'url'], hasId: true }],
        errors: [],
      },
    ],
    structuredDataTypes: ['WebPage'],
    structuredDataErrors: [],

    inSitemap: true,
    isOrphan: false,

    https: url.startsWith('https://'),
    mixedContent: [],
    hasViewport: true,
    ogTitle: 'Titolo social',
    ogImage: 'https://example.com/og.png',
    securityHeaders: {
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },

    contentHash: Math.random().toString(36).slice(2),
    content: null,

    fetchError: null,
    ...overrides,
  };
}

export function makeCrawlResult(pages: CrawledUrl[], overrides: Partial<CrawlResult> = {}): CrawlResult {
  return {
    config: makeConfig(),
    rootUrl: 'https://example.com/',
    startedAt: '2026-01-01T10:00:00.000Z',
    finishedAt: '2026-01-01T10:02:00.000Z',
    durationMs: 120000,
    pages,
    robots: {
      url: 'https://example.com/robots.txt',
      found: true,
      statusCode: 200,
      content: 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml',
      sitemaps: ['https://example.com/sitemap.xml'],
      blocksEverything: false,
      error: null,
    },
    sitemap: {
      urls: pages.filter((p) => p.inSitemap).map((p) => p.url),
      sources: ['https://example.com/sitemap.xml'],
      errors: [],
      found: true,
    },
    limitReached: null,
    warnings: [],
    ...overrides,
  };
}
