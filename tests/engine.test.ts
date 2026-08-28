import { describe, expect, it } from 'vitest';
import { runAudit } from '../src/audit/engine';
import { SEVERITY_ORDER } from '../src/audit/types';
import { makeCrawlResult, makePage } from './factories';

function auditOf(pages: ReturnType<typeof makePage>[]) {
  return runAudit(makeCrawlResult(pages));
}

function ids(audit: ReturnType<typeof runAudit>): string[] {
  return audit.issues.map((i) => i.id);
}

describe('motore di audit', () => {
  it('non segnala nulla di critico su un sito pulito', () => {
    const audit = auditOf([
      makePage({ url: 'https://example.com/', depth: 0 }),
      makePage({ url: 'https://example.com/servizi', depth: 1, title: 'Servizi di consulenza SEO' }),
      makePage({ url: 'https://example.com/contatti', depth: 1, title: 'Contatta il nostro team' }),
    ]);

    expect(audit.summary.issuesBySeverity.critical).toBe(0);
    expect(audit.score.total).toBeGreaterThan(60);
  });

  it('rileva title mancanti e duplicati', () => {
    const audit = auditOf([
      makePage({ url: 'https://example.com/', title: null, titleLength: 0 }),
      makePage({ url: 'https://example.com/a', depth: 1, title: 'Stesso titolo', titleLength: 13 }),
      makePage({ url: 'https://example.com/b', depth: 1, title: 'Stesso titolo', titleLength: 13 }),
    ]);

    expect(ids(audit)).toContain('missing-title');
    expect(ids(audit)).toContain('duplicate-title');

    const duplicate = audit.issues.find((i) => i.id === 'duplicate-title');
    expect(duplicate?.affectedCount).toBe(2);
  });

  it('rileva errori 4xx e 5xx', () => {
    const audit = auditOf([
      makePage({ url: 'https://example.com/' }),
      makePage({
        url: 'https://example.com/rotta',
        depth: 1,
        statusCode: 404,
        indexable: false,
        indexabilityStatus: 'Client Error',
        uniqueInlinks: 3,
      }),
      makePage({
        url: 'https://example.com/errore',
        depth: 1,
        statusCode: 500,
        indexable: false,
        indexabilityStatus: 'Server Error',
      }),
    ]);

    expect(ids(audit)).toContain('broken-internal-links');
    expect(ids(audit)).toContain('server-errors');
    expect(audit.summary.brokenPages).toBe(1);
    expect(audit.summary.serverErrors).toBe(1);
    expect(audit.summary.issuesBySeverity.critical).toBeGreaterThanOrEqual(2);
  });

  it('rileva catene e loop di redirect', () => {
    const audit = auditOf([
      makePage({ url: 'https://example.com/' }),
      makePage({
        url: 'https://example.com/vecchia',
        depth: 1,
        statusCode: 200,
        redirectChain: [
          { url: 'https://example.com/vecchia', status: 301, location: '/media' },
          { url: 'https://example.com/media', status: 301, location: '/nuova' },
        ],
        finalUrl: 'https://example.com/nuova',
        redirectTarget: 'https://example.com/nuova',
        uniqueInlinks: 2,
      }),
      makePage({
        url: 'https://example.com/loop',
        depth: 1,
        redirectLoop: true,
        redirectChain: [{ url: 'https://example.com/loop', status: 301, location: '/loop' }],
      }),
    ]);

    expect(ids(audit)).toContain('redirect-chains');
    expect(ids(audit)).toContain('redirect-loops');
    expect(ids(audit)).toContain('internal-links-to-redirects');
  });

  it('rileva noindex, contenuto scarso e H1 mancante', () => {
    const audit = auditOf([
      makePage({ url: 'https://example.com/' }),
      makePage({
        url: 'https://example.com/privata',
        depth: 1,
        noindex: true,
        metaRobots: 'noindex, follow',
        indexable: false,
        indexabilityStatus: 'Noindex',
      }),
      makePage({ url: 'https://example.com/scarna', depth: 1, wordCount: 40, h1: [] }),
    ]);

    expect(ids(audit)).toContain('noindex-pages');
    expect(ids(audit)).toContain('thin-content');
    expect(ids(audit)).toContain('missing-h1');
  });

  it('rileva immagini senza alt e dati strutturati non validi', () => {
    const audit = auditOf([
      makePage({
        url: 'https://example.com/',
        images: [
          { src: 'https://example.com/a.jpg', alt: null, hasAltAttribute: false, width: null, height: null, loading: null },
          { src: 'https://example.com/b.jpg', alt: 'ok', hasAltAttribute: true, width: '10', height: '10', loading: 'lazy' },
        ],
        imagesMissingAlt: 1,
        structuredDataErrors: ['$ (Product): manca la proprieta obbligatoria "name"'],
      }),
    ]);

    expect(ids(audit)).toContain('images-missing-alt');
    expect(ids(audit)).toContain('invalid-structured-data');
    expect(audit.summary.imagesMissingAlt).toBe(1);
  });

  it('rileva le pagine orfane e quelle troppo profonde', () => {
    const audit = auditOf([
      makePage({ url: 'https://example.com/' }),
      makePage({ url: 'https://example.com/orfana', depth: 0, uniqueInlinks: 0, isOrphan: true }),
      makePage({ url: 'https://example.com/a/b/c/d/e', depth: 5 }),
    ]);

    expect(ids(audit)).toContain('orphan-pages');
    expect(ids(audit)).toContain('deep-pages');
    expect(audit.summary.orphanPages).toBe(1);
  });

  it('rileva HTTP e contenuto misto', () => {
    const audit = auditOf([
      makePage({ url: 'http://example.com/', https: false }),
      makePage({
        url: 'https://example.com/mista',
        depth: 1,
        mixedContent: ['http://cdn.example.com/script.js'],
      }),
    ]);

    expect(ids(audit)).toContain('http-pages');
    expect(ids(audit)).toContain('mixed-content');
  });

  it('segnala la sitemap assente', () => {
    const crawl = makeCrawlResult([makePage({ url: 'https://example.com/', inSitemap: false })], {
      sitemap: { urls: [], sources: [], errors: [], found: false },
    });
    const audit = runAudit(crawl);
    expect(audit.issues.map((i) => i.id)).toContain('sitemap-missing');
  });

  it('segnala il robots.txt che blocca tutto come problema critico', () => {
    const crawl = makeCrawlResult([makePage({ url: 'https://example.com/' })], {
      robots: {
        url: 'https://example.com/robots.txt',
        found: true,
        statusCode: 200,
        content: 'User-agent: *\nDisallow: /',
        sitemaps: [],
        blocksEverything: true,
        error: null,
      },
    });
    const audit = runAudit(crawl);
    const issue = audit.issues.find((i) => i.id === 'robots-blocks-site');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('critical');
    expect(issue?.priority).toBe('P0');
  });

  it('ordina le issue dalla piu grave', () => {
    const audit = auditOf([
      makePage({ url: 'https://example.com/', title: null, titleLength: 0 }),
      makePage({ url: 'https://example.com/x', depth: 1, statusCode: 500, indexable: false, indexabilityStatus: 'Server Error' }),
      makePage({ url: 'https://example.com/y', depth: 1, wordCount: 10 }),
    ]);

    const order = audit.issues.map((i) => SEVERITY_ORDER[i.severity]);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
    }
  });

  it('assegna id e dominio all audit', () => {
    const audit = auditOf([makePage({ url: 'https://example.com/' })]);
    expect(audit.domain).toBe('example.com');
    expect(audit.id).toMatch(/^[a-z0-9]+$/);
    expect(audit.score.categories).toHaveLength(15);
  });
});
