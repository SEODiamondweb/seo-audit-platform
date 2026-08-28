import { runAudit } from './audit/engine';
import { env } from './config/env';
import { renderReportHtml } from './report/html';
import { closeBrowser, renderPdf } from './report/pdf';
import { auditPaths, loadLogoDataUri, saveSnapshot, writeText } from './report/store';
import type { CrawlResult, CrawledUrl } from './crawler/types';

/**
 * Genera un report di esempio da dati sintetici, senza toccare la rete.
 * Serve per verificare la catena HTML -> PDF e per mostrare l’output a un cliente.
 *
 *   npm run demo
 */

const DOMAIN = 'https://demo-cliente.it';

function page(overrides: Partial<CrawledUrl> & { url: string }): CrawledUrl {
  const { url, ...rest } = overrides;
  return {
    url,
    finalUrl: url,
    statusCode: 200,
    statusText: 'OK',
    contentType: 'text/html; charset=utf-8',
    isHtml: true,
    indexable: true,
    indexabilityStatus: 'Indexable',
    title: 'Pagina demo',
    titleLength: 11,
    metaDescription: null,
    metaDescriptionLength: 0,
    h1: ['Titolo'],
    h2: ['Sezione'],
    canonical: url,
    canonicalResolved: url,
    isSelfCanonical: true,
    metaRobots: null,
    xRobotsTag: null,
    noindex: false,
    nofollowPage: false,
    hreflang: [],
    lang: 'it',
    wordCount: 620,
    textRatio: 0.22,
    depth: 1,
    inlinks: 3,
    uniqueInlinks: 3,
    linkedFrom: [],
    outlinks: 24,
    externalOutlinks: 3,
    nofollowOutlinks: 0,
    internalLinks: [],
    externalLinks: [],
    redirectChain: [],
    redirectTarget: null,
    redirectLoop: false,
    responseTimeMs: 420,
    sizeBytes: 82000,
    images: [],
    imagesMissingAlt: 0,
    structuredData: [],
    structuredDataTypes: [],
    structuredDataErrors: [],
    inSitemap: true,
    isOrphan: false,
    https: true,
    mixedContent: [],
    hasViewport: true,
    ogTitle: null,
    ogImage: null,
    securityHeaders: { 'strict-transport-security': 'max-age=31536000' },
    contentHash: 'hash-' + url,
    content: null,
    fetchError: null,
    ...rest,
  };
}

function buildDemoCrawl(): CrawlResult {
  const pages: CrawledUrl[] = [
    page({
      url: DOMAIN + '/',
      depth: 0,
      title: 'Home',
      titleLength: 4,
      wordCount: 240,
      uniqueInlinks: 42,
      responseTimeMs: 1800,
    }),
  ];

  // Sezioni "sane"
  for (let i = 1; i <= 18; i++) {
    pages.push(
      page({
        url: DOMAIN + '/servizi/servizio-' + i,
        title: 'Servizio ' + i + ' — consulenza specialistica per aziende',
        titleLength: 52,
        metaDescription:
          'Scopri il servizio ' + i + ': analisi, implementazione e monitoraggio continuo per la tua azienda.',
        metaDescriptionLength: 108,
        depth: 2,
        images: [
          {
            src: DOMAIN + '/img/servizio-' + i + '.jpg',
            alt: null,
            hasAltAttribute: false,
            width: null,
            height: null,
            loading: null,
          },
        ],
        imagesMissingAlt: 1,
      }),
    );
  }

  // Blog profondo, poco linkato e con title duplicati
  for (let i = 1; i <= 12; i++) {
    pages.push(
      page({
        url: DOMAIN + '/blog/2025/11/articolo-' + i,
        title: 'Blog',
        titleLength: 4,
        depth: 5,
        uniqueInlinks: i % 4 === 0 ? 0 : 1,
        isOrphan: i % 4 === 0,
        wordCount: 180,
        h1: [],
      }),
    );
  }

  // Errori e redirect
  pages.push(
    page({
      url: DOMAIN + '/prodotti/vecchio',
      statusCode: 404,
      statusText: 'Not Found',
      indexable: false,
      indexabilityStatus: 'Client Error',
      isHtml: true,
      uniqueInlinks: 7,
      depth: 2,
    }),
    page({
      url: DOMAIN + '/checkout',
      statusCode: 500,
      statusText: 'Internal Server Error',
      indexable: false,
      indexabilityStatus: 'Server Error',
      uniqueInlinks: 3,
      depth: 1,
    }),
    page({
      url: DOMAIN + '/promo-estate',
      redirectChain: [
        { url: DOMAIN + '/promo-estate', status: 302, location: '/promo' },
        { url: DOMAIN + '/promo', status: 301, location: '/promozioni' },
      ],
      finalUrl: DOMAIN + '/promozioni',
      redirectTarget: DOMAIN + '/promozioni',
      indexable: false,
      indexabilityStatus: 'Redirect',
      uniqueInlinks: 5,
      depth: 1,
    }),
    page({
      url: DOMAIN + '/area-riservata',
      noindex: true,
      metaRobots: 'noindex, nofollow',
      indexable: false,
      indexabilityStatus: 'Noindex',
      depth: 1,
    }),
    page({
      url: 'http://demo-cliente.it/vecchia-landing',
      https: false,
      depth: 1,
      uniqueInlinks: 2,
    }),
    page({
      url: DOMAIN + '/catalogo',
      depth: 1,
      mixedContent: ['http://cdn.demo-cliente.it/slider.js'],
      structuredDataErrors: ['$ (Product): manca la proprietà obbligatoria "name"'],
      structuredData: [
        {
          format: 'json-ld',
          types: ['Product'],
          entities: [{ type: 'Product', properties: ['description'], hasId: false }],
          errors: ['manca name'],
        },
      ],
      structuredDataTypes: ['Product'],
      responseTimeMs: 3400,
      sizeBytes: 2600000,
    }),
  );

  return {
    config: {
      startUrl: DOMAIN + '/',
      maxUrls: 500,
      maxDepth: 10,
      concurrency: 5,
      delayMs: 200,
      timeoutMs: 15000,
      respectRobots: true,
      includeSubdomains: false,
      userAgent: env.CRAWL_USER_AGENT,
      include: [],
      exclude: [],
    },
    rootUrl: DOMAIN + '/',
    startedAt: new Date(Date.now() - 180000).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 180000,
    pages,
    robots: {
      url: DOMAIN + '/robots.txt',
      found: true,
      statusCode: 200,
      content: 'User-agent: *\nAllow: /',
      sitemaps: [],
      blocksEverything: false,
      error: null,
    },
    sitemap: {
      urls: pages.filter((p) => p.inSitemap).map((p) => p.url),
      sources: [DOMAIN + '/sitemap.xml'],
      errors: [],
      found: true,
    },
    limitReached: null,
    warnings: ['Report dimostrativo generato da dati sintetici: nessuna scansione reale eseguita.'],
  };
}

async function main(): Promise<void> {
  const audit = runAudit(buildDemoCrawl(), { requestedBy: 'demo' });
  const paths = auditPaths(audit);

  const html = await renderReportHtml(audit, {
    brandName: env.REPORT_BRAND_NAME,
    brandColor: env.REPORT_BRAND_COLOR,
    logoDataUri: await loadLogoDataUri(),
  });

  await writeText(paths.htmlPath, html);
  await saveSnapshot(audit, paths.jsonPath);
  await renderPdf(html, paths.pdfPath, {
    footerLeft: env.REPORT_BRAND_NAME + ' · SEO Audit ' + audit.domain,
  });

  process.stdout.write('Report demo generato.\n');
  process.stdout.write('  Punteggio: ' + audit.score.total + '/100 (' + audit.score.grade + ')\n');
  process.stdout.write('  Problemi : ' + audit.issues.length + '\n');
  process.stdout.write('  PDF      : ' + paths.pdfPath + '\n');
  process.stdout.write('  HTML     : ' + paths.htmlPath + '\n');

  await closeBrowser();
}

main().catch(async (err: unknown) => {
  process.stderr.write('Demo fallita: ' + (err instanceof Error ? err.message : String(err)) + '\n');
  await closeBrowser();
  process.exit(1);
});
