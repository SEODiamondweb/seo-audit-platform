import { runAudit } from './audit/engine';
import { crawl } from './crawler/crawler';
import { env } from './config/env';
import { renderReportHtml } from './report/html';
import { renderPdf } from './report/pdf';
import { auditPaths, loadLogoDataUri, saveSnapshot, writeText } from './report/store';
import { logger } from './utils/logger';
import { runPageSpeed } from './pagespeed';
import { analyzeCrawlerLogs } from './crawlers/report';
import { collectGscData } from './gsc';
import { normalizeUrl, safeParseUrl } from './utils/url';
import type { AuditResult } from './audit/types';
import type { CrawlConfig } from './crawler/types';

export type AuditPhase = 'crawl' | 'pagespeed' | 'analyze' | 'report' | 'done';

export interface AuditProgress {
  phase: AuditPhase;
  crawled: number;
  queued: number;
  message: string;
}

export interface AuditRequest {
  /** URL inserita dall’utente, anche senza protocollo. */
  url: string;
  overrides?: Partial<Omit<CrawlConfig, 'startUrl'>>;
  requestedBy?: string;
}

export interface AuditArtifacts {
  audit: AuditResult;
  pdfPath: string;
  pdfBuffer: Buffer;
  htmlPath: string;
  jsonPath: string;
  fileBaseName: string;
}

export interface PipelineHooks {
  onProgress?: (progress: AuditProgress) => void;
  shouldStop?: () => boolean;
}

/** Accetta "example.com", "www.example.com/path", "https://example.com" e normalizza in URL assoluta. */
export function resolveStartUrl(input: string): string {
  const trimmed = input.trim().replace(/^<|>$/g, '');
  if (!trimmed) throw new Error('Nessun dominio indicato.');

  // Slack incapsula i link come <https://example.com|example.com>
  const unwrapped = trimmed.includes('|') ? (trimmed.split('|')[0] as string) : trimmed;
  const withProtocol = /^https?:\/\//i.test(unwrapped) ? unwrapped : 'https://' + unwrapped;

  const parsed = safeParseUrl(withProtocol);
  if (!parsed) throw new Error('Dominio non valido: ' + input);
  if (!parsed.hostname.includes('.')) throw new Error('Dominio non valido: ' + input);

  return normalizeUrl(parsed.toString()) ?? parsed.toString();
}

export function buildCrawlConfig(
  startUrl: string,
  overrides: Partial<Omit<CrawlConfig, 'startUrl'>> = {},
): CrawlConfig {
  return {
    startUrl,
    maxUrls: overrides.maxUrls ?? env.CRAWL_MAX_URLS,
    maxDepth: overrides.maxDepth ?? env.CRAWL_MAX_DEPTH,
    concurrency: overrides.concurrency ?? env.CRAWL_CONCURRENCY,
    delayMs: overrides.delayMs ?? env.CRAWL_DELAY_MS,
    timeoutMs: overrides.timeoutMs ?? env.CRAWL_TIMEOUT_MS,
    respectRobots: overrides.respectRobots ?? env.CRAWL_RESPECT_ROBOTS,
    includeSubdomains: overrides.includeSubdomains ?? env.CRAWL_INCLUDE_SUBDOMAINS,
    userAgent: overrides.userAgent ?? env.CRAWL_USER_AGENT,
    include: overrides.include ?? [],
    exclude: overrides.exclude ?? [],
    sitemapUrl: overrides.sitemapUrl,
  };
}

/**
 * Esegue l’intera catena: scansione -> motore di audit -> report PDF su disco.
 * Non gestisce Slack: e riusabile da CLI, test e futuri entry point.
 */
export async function runFullAudit(
  request: AuditRequest,
  hooks: PipelineHooks = {},
): Promise<AuditArtifacts> {
  const startUrl = resolveStartUrl(request.url);
  const config = buildCrawlConfig(startUrl, request.overrides);

  logger.info({ startUrl, maxUrls: config.maxUrls }, 'Avvio audit');

  hooks.onProgress?.({
    phase: 'crawl',
    crawled: 0,
    queued: 1,
    message: 'Scansione in corso…',
  });

  const crawlResult = await crawl(config, {
    shouldStop: hooks.shouldStop,
    onProgress: (progress) => {
      hooks.onProgress?.({
        phase: 'crawl',
        crawled: progress.crawled,
        queued: progress.queued,
        message: 'Scansione in corso…',
      });
    },
  });

  if (crawlResult.pages.length === 0) {
    throw new Error(
      'Nessuna pagina scansionata. Verifica che il dominio risponda e che il robots.txt non blocchi il crawler.',
    );
  }

  hooks.onProgress?.({
    phase: 'pagespeed',
    crawled: crawlResult.pages.length,
    queued: 0,
    message: 'Misurazione della velocità con PageSpeed Insights…',
  });

  // PSI e analisi dei log sono indipendenti dal crawl e fra loro: in parallelo.
  const homePage = crawlResult.pages.find((p) => p.depth === 0);
  const domain = new URL(startUrl).hostname;
  // Il campione da ispezionare in GSC: le pagine più linkate internamente.
  const topByInlinks = crawlResult.pages
    .filter((p) => p.isHtml && p.statusCode >= 200 && p.statusCode < 300)
    .sort((a, b) => b.uniqueInlinks - a.uniqueInlinks)
    .slice(0, 30)
    .map((p) => p.url);

  const [pagespeed, crawlers, gsc] = await Promise.all([
    runPageSpeed(homePage?.finalUrl ?? startUrl),
    analyzeCrawlerLogs(domain),
    collectGscData(domain, topByInlinks).catch((err: unknown) => {
      logger.warn({ err }, 'Search Console non disponibile per questo audit');
      return null;
    }),
  ]);

  hooks.onProgress?.({
    phase: 'analyze',
    crawled: crawlResult.pages.length,
    queued: 0,
    message: 'Analisi dei problemi SEO…',
  });

  const audit = runAudit(crawlResult, { requestedBy: request.requestedBy, pagespeed, crawlers, gsc });

  hooks.onProgress?.({
    phase: 'report',
    crawled: crawlResult.pages.length,
    queued: 0,
    message: 'Generazione del report PDF…',
  });

  const paths = auditPaths(audit);
  const logoDataUri = await loadLogoDataUri();

  const html = renderReportHtml(audit, {
    brandName: env.REPORT_BRAND_NAME,
    brandColor: env.REPORT_BRAND_COLOR,
    logoDataUri,
  });

  await writeText(paths.htmlPath, html);
  await saveSnapshot(audit, paths.jsonPath);

  const pdfBuffer = await renderPdf(html, paths.pdfPath, {
    footerLeft: env.REPORT_BRAND_NAME + ' · SEO Audit ' + audit.domain,
  });

  hooks.onProgress?.({
    phase: 'done',
    crawled: crawlResult.pages.length,
    queued: 0,
    message: 'Report pronto',
  });

  logger.info(
    { domain: audit.domain, score: audit.score.total, issues: audit.issues.length },
    'Audit completato',
  );

  return {
    audit,
    pdfPath: paths.pdfPath,
    pdfBuffer,
    htmlPath: paths.htmlPath,
    jsonPath: paths.jsonPath,
    fileBaseName: paths.baseName,
  };
}
