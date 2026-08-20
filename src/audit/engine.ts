import { ALL_RULES } from './rules';
import { computeScore, priorityFor } from './score';
import { SEVERITY_ORDER } from './types';
import type {
  AuditContext,
  AuditIssue,
  AuditResult,
  AuditSummary,
  Priority,
  Severity,
} from './types';
import type { CrawlResult, CrawledUrl } from '../crawler/types';
import { logger } from '../utils/logger';
import { shortHash } from '../utils/text';
import { refineKeywords } from '../content';
import type { PageSpeedResult } from '../pagespeed';
import type { CrawlerLogReport } from '../crawlers/report';
import type { GscReport } from '../gsc';
import { safeParseUrl } from '../utils/url';

/** Numero massimo di URL conservate per issue: tiene lo snapshot JSON di dimensioni gestibili. */
const MAX_URLS_PER_ISSUE = 1000;

export interface AuditOptions {
  requestedBy?: string;
  pagespeed?: PageSpeedResult | null;
  crawlers?: CrawlerLogReport | null;
  gsc?: GscReport | null;
}

export function buildContext(
  crawl: CrawlResult,
  pagespeed: PageSpeedResult | null = null,
  crawlers: CrawlerLogReport | null = null,
  gsc: GscReport | null = null,
): AuditContext {
  const pages = crawl.pages;

  // Passata trasversale: solo confrontando le pagine fra loro si riconosce quali locuzioni
  // sono testo di contorno ripetuto su tutto il sito e quali distinguono davvero la pagina.
  // Muta l analisi gia presente sulle pagine, quindi va eseguita prima delle regole.
  refineKeywords(pages);
  // Solo HTML effettivamente servito: i redirect sono riportati con lo status del primo hop
  // e il loro contenuto appartiene alla URL di destinazione, non a quella di partenza.
  const htmlPages = pages.filter((p) => p.isHtml && p.statusCode >= 200 && p.statusCode < 300);
  const indexablePages = htmlPages.filter((p) => p.indexable);

  const pagesByUrl = new Map<string, CrawledUrl>();
  for (const page of pages) pagesByUrl.set(page.url, page);

  return {
    crawl,
    pages,
    htmlPages,
    indexablePages,
    pagesByUrl,
    totalPages: pages.length,
    pagespeed,
    crawlers,
    gsc,
  };
}


/**
 * Conta le immagini per URL distinta, non per occorrenza.
 *
 * Sommare page.images.length su tutte le pagine conta il logo una volta per pagina: su un sito
 * da 50 pagine con 24 immagini reali il totale diventava 228, un numero che al cliente non
 * dice nulla. Un'immagine risulta senza alt se le manca l'attributo in almeno un punto del sito.
 */
function countUniqueImages(pages: CrawledUrl[]): { totalImages: number; imagesMissingAlt: number } {
  const seen = new Set<string>();
  const missingAlt = new Set<string>();

  for (const page of pages) {
    for (const image of page.images) {
      seen.add(image.src);
      if (!image.hasAltAttribute) missingAlt.add(image.src);
    }
  }

  return { totalImages: seen.size, imagesMissingAlt: missingAlt.size };
}

function buildSummary(ctx: AuditContext, issues: AuditIssue[]): AuditSummary {
  const { pages, htmlPages, indexablePages } = ctx;

  const timed = pages.filter((p) => p.responseTimeMs > 0 && p.statusCode > 0);
  const avgResponseTimeMs =
    timed.length > 0 ? Math.round(timed.reduce((acc, p) => acc + p.responseTimeMs, 0) / timed.length) : 0;

  const withWords = indexablePages.filter((p) => p.wordCount > 0);
  const avgWordCount =
    withWords.length > 0
      ? Math.round(withWords.reduce((acc, p) => acc + p.wordCount, 0) / withWords.length)
      : 0;

  const issuesBySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const issuesByPriority: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const issue of issues) {
    issuesBySeverity[issue.severity] += 1;
    issuesByPriority[issue.priority] += 1;
  }

  return {
    totalPages: pages.length,
    htmlPages: htmlPages.length,
    indexablePages: indexablePages.length,
    nonIndexablePages: pages.length - indexablePages.length,
    brokenPages: pages.filter((p) => p.statusCode >= 400 && p.statusCode < 500).length,
    redirects: pages.filter((p) => p.redirectChain.length > 0).length,
    serverErrors: pages.filter((p) => p.statusCode >= 500).length,
    avgResponseTimeMs,
    avgWordCount,
    maxDepth: pages.reduce((max, p) => Math.max(max, p.depth), 0),
    orphanPages: pages.filter((p) => p.isOrphan).length,
    sitemapUrls: ctx.crawl.sitemap.urls.length,
    ...countUniqueImages(htmlPages),
    issuesBySeverity,
    issuesByPriority,
  };
}

export function runAudit(crawl: CrawlResult, options: AuditOptions = {}): AuditResult {
  const { requestedBy, pagespeed = null, crawlers = null, gsc = null } = options;
  const ctx = buildContext(crawl, pagespeed, crawlers, gsc);
  const defaultScope = Math.max(1, ctx.htmlPages.length || ctx.totalPages);

  const issues: AuditIssue[] = [];
  const scoreInputs: { issue: AuditIssue; touchesTopPages: boolean }[] = [];

  for (const rule of ALL_RULES) {
    let finding;
    try {
      finding = rule.evaluate(ctx);
    } catch (err) {
      logger.warn({ rule: rule.id, err }, 'Regola di audit fallita, viene saltata');
      continue;
    }
    if (!finding || finding.urls.length === 0) continue;

    const scope = finding.scopeSize ?? defaultScope;
    const affectedCount = finding.urls.length;
    const affectedRatio = Math.min(1, affectedCount / Math.max(1, scope));
    const severity = finding.severityOverride ?? rule.severity;

    // Le orfane sono escluse: hanno profondità 0 solo perché scoperte da sitemap,
    // non perché siano pagine di primo livello.
    const touchesTopPages = finding.urls.some((entry) => {
      const page = ctx.pagesByUrl.get(entry.url);
      return page !== undefined && page.depth <= 1 && !page.isOrphan;
    });

    const issue: AuditIssue = {
      id: rule.id,
      title: rule.title,
      category: rule.category,
      severity,
      priority: priorityFor(severity, affectedRatio),
      description: finding.note ? rule.description + ' ' + finding.note : rule.description,
      seoImpact: rule.seoImpact,
      recommendation: rule.recommendation,
      effort: rule.effort,
      status: 'open',
      assignee: null,
      urls: finding.urls.slice(0, MAX_URLS_PER_ISSUE),
      affectedCount,
      affectedRatio,
      scorePenalty: 0,
    };

    issues.push(issue);
    scoreInputs.push({ issue, touchesTopPages });
  }

  const score = computeScore(scoreInputs);

  issues.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (b.scorePenalty !== a.scorePenalty) return b.scorePenalty - a.scorePenalty;
    return b.affectedCount - a.affectedCount;
  });

  const summary = buildSummary(ctx, issues);

  const parsedRoot = safeParseUrl(crawl.rootUrl);
  const domain = parsedRoot ? parsedRoot.hostname : crawl.rootUrl;
  const createdAt = new Date().toISOString();

  return {
    id: shortHash(crawl.rootUrl + '|' + createdAt),
    domain,
    rootUrl: crawl.rootUrl,
    createdAt,
    crawl,
    score,
    issues,
    summary,
    pagespeed,
    crawlers,
    gsc,
    requestedBy,
  };
}
