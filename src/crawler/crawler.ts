import { fetchUrl } from './fetcher';
import { parseHtml } from './parse';
import { loadRobots } from './robots';
import { defaultSitemapCandidates, loadSitemaps } from './sitemap';
import type { SitemapCandidate } from './sitemap';
import { isSameSite, looksLikeAsset, normalizeUrl, safeParseUrl } from '../utils/url';
import { sleep } from '../utils/concurrency';
import { logger } from '../utils/logger';
import type {
  CrawlConfig,
  CrawlProgress,
  CrawlResult,
  CrawledUrl,
  IndexabilityStatus,
  LinkRef,
  RedirectHop,
} from './types';

interface QueueItem {
  url: string;
  depth: number;
  source: 'link' | 'sitemap' | 'start';
}

export interface CrawlHooks {
  onProgress?: (progress: CrawlProgress) => void;
  /** Se ritorna true il crawl viene interrotto in modo pulito. */
  shouldStop?: () => boolean;
}

function compileFilters(patterns: string[], warnings: string[], label: string): RegExp[] {
  const out: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      out.push(new RegExp(pattern, 'i'));
    } catch {
      warnings.push(`Pattern ${label} ignorato perché non è una regex valida: ${pattern}`);
    }
  }
  return out;
}

function deriveIndexability(
  statusCode: number,
  isHtml: boolean,
  noindex: boolean,
  blockedByRobots: boolean,
  isSelfCanonical: boolean,
  hasCanonical: boolean,
  isRedirect: boolean,
  fetchError: string | null,
): { indexable: boolean; status: IndexabilityStatus } {
  if (fetchError) return { indexable: false, status: 'Fetch Error' };
  if (blockedByRobots) return { indexable: false, status: 'Blocked by robots.txt' };
  if (isRedirect) return { indexable: false, status: 'Redirect' };
  if (statusCode >= 500) return { indexable: false, status: 'Server Error' };
  if (statusCode >= 400) return { indexable: false, status: 'Client Error' };
  if (!isHtml) return { indexable: false, status: 'Non-HTML' };
  if (noindex) return { indexable: false, status: 'Noindex' };
  if (hasCanonical && !isSelfCanonical) return { indexable: false, status: 'Canonicalised' };
  return { indexable: true, status: 'Indexable' };
}

export async function crawl(config: CrawlConfig, hooks: CrawlHooks = {}): Promise<CrawlResult> {
  const startedAt = new Date();
  const warnings: string[] = [];

  const root = safeParseUrl(config.startUrl);
  if (!root) throw new Error(`URL di partenza non valida: ${config.startUrl}`);

  const includeFilters = compileFilters(config.include, warnings, 'include');
  const excludeFilters = compileFilters(config.exclude, warnings, 'exclude');

  const robots = await loadRobots(root.toString(), config.userAgent, config.timeoutMs);
  if (config.respectRobots && robots.info.blocksEverything) {
    warnings.push(
      'Il robots.txt blocca completamente lo user agent configurato: il crawl restituira pochissime URL. ' +
        'Usa --no-robots per ignorarlo (solo su siti di cui hai il controllo).',
    );
  }

  // Le sitemap dichiarate dal sito sono "attese": se rispondono male è un problema da segnalare.
  // I percorsi convenzionali sono solo tentativi alla cieca: un 404 lì non è un'anomalia del sito.
  const sitemapCandidates: SitemapCandidate[] = [
    ...(config.sitemapUrl ? [{ url: config.sitemapUrl, declared: true }] : []),
    ...robots.info.sitemaps.map((url) => ({ url, declared: true })),
    ...defaultSitemapCandidates(root.toString()).map((url) => ({ url, declared: false })),
  ];
  const sitemap = await loadSitemaps(
    root.toString(),
    sitemapCandidates,
    config.userAgent,
    config.timeoutMs,
  );
  const sitemapSet = new Set(sitemap.urls);

  const seen = new Set<string>();
  const queue: QueueItem[] = [];
  const pages: CrawledUrl[] = [];
  /** url -> numero di link entranti interni (uno per link, anche ripetuti sulla stessa pagina). */
  const inlinks = new Map<string, number>();
  const uniqueInlinkSources = new Map<string, Set<string>>();
  /** Destinazioni di redirect: raggiungibili anche senza link diretti, quindi non sono orfane. */
  const redirectTargets = new Set<string>();

  let limitReached: CrawlResult['limitReached'] = null;
  let stopped = false;

  const startNormalized = normalizeUrl(root.toString()) ?? root.toString();
  seen.add(startNormalized);
  queue.push({ url: startNormalized, depth: 0, source: 'start' });

  function inScope(candidate: URL): boolean {
    if (!isSameSite(candidate, root as URL, config.includeSubdomains)) return false;
    const href = candidate.toString();
    if (excludeFilters.some((re) => re.test(href))) return false;
    if (includeFilters.length > 0 && !includeFilters.some((re) => re.test(href))) return false;
    return true;
  }

  function enqueue(rawUrl: string, depth: number, source: QueueItem['source']): void {
    if (pages.length + queue.length >= config.maxUrls) return;
    if (depth > config.maxDepth) {
      limitReached = limitReached ?? 'maxDepth';
      return;
    }
    const normalized = normalizeUrl(rawUrl);
    if (!normalized || seen.has(normalized)) return;
    const parsed = safeParseUrl(normalized);
    if (!parsed || !inScope(parsed) || looksLikeAsset(parsed)) return;
    seen.add(normalized);
    queue.push({ url: normalized, depth, source });
  }

  function registerLink(fromUrl: string, link: LinkRef): void {
    const normalized = normalizeUrl(link.url);
    if (!normalized) return;
    inlinks.set(normalized, (inlinks.get(normalized) ?? 0) + 1);
    let sources = uniqueInlinkSources.get(normalized);
    if (!sources) {
      sources = new Set<string>();
      uniqueInlinkSources.set(normalized, sources);
    }
    sources.add(fromUrl);
  }

  async function processOne(item: QueueItem): Promise<void> {
    const blockedByRobots = config.respectRobots && !robots.isAllowed(item.url);

    if (blockedByRobots) {
      pages.push(
        buildBlockedPage(item, sitemapSet.has(item.url)),
      );
      return;
    }

    const outcome = await fetchUrl(item.url, {
      userAgent: config.userAgent,
      timeoutMs: config.timeoutMs,
    });

    const contentType = outcome.headers['content-type'] ?? '';
    const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);
    const isRedirect = outcome.redirectChain.length > 0;

    // Una URL che redirige va riportata con lo status del primo hop, non con quello della
    // destinazione: lo status finale appartiene alla URL di arrivo, che viene accodata a parte.
    const reportedStatus = isRedirect
      ? (outcome.redirectChain[0] as RedirectHop).status
      : outcome.status;
    const reportedStatusText = isRedirect ? 'Redirect' : outcome.statusText;

    if (isRedirect && !outcome.redirectLoop) {
      enqueue(outcome.finalUrl, item.depth, 'link');
      redirectTargets.add(normalizeUrl(outcome.finalUrl) ?? outcome.finalUrl);
    }

    // Il contenuto raggiunto dopo un redirect appartiene alla URL di destinazione: la URL di
    // partenza non ne eredita né title, né link (altrimenti gli inlink verrebbero contati due volte).
    const parsed =
      isHtml && outcome.body && !isRedirect ? parseHtml(outcome.body, outcome.finalUrl) : null;

    const metaRobotsValue = [parsed?.metaRobots ?? '', outcome.headers['x-robots-tag'] ?? '']
      .filter((v) => v !== '')
      .join(', ');
    const noindex = /\bnoindex\b/i.test(metaRobotsValue);
    const nofollowPage = /\bnofollow\b/i.test(metaRobotsValue);

    const canonicalResolved = parsed?.canonical
      ? normalizeUrl(parsed.canonical, outcome.finalUrl)
      : null;
    const normalizedFinal = normalizeUrl(outcome.finalUrl) ?? outcome.finalUrl;
    const isSelfCanonical = canonicalResolved !== null && canonicalResolved === normalizedFinal;

    const { indexable, status } = deriveIndexability(
      reportedStatus,
      isHtml,
      noindex,
      false,
      isSelfCanonical,
      canonicalResolved !== null,
      isRedirect,
      outcome.error,
    );

    const internalLinks: LinkRef[] = [];
    const externalLinks: LinkRef[] = [];

    if (parsed) {
      for (const link of parsed.links) {
        const parsedLink = safeParseUrl(link.url);
        if (!parsedLink) continue;
        if (isSameSite(parsedLink, root as URL, config.includeSubdomains)) {
          internalLinks.push(link);
          registerLink(item.url, link);
          if (!link.nofollow && !nofollowPage) {
            enqueue(link.url, item.depth + 1, 'link');
          }
        } else {
          externalLinks.push(link);
        }
      }
    }

    const images = parsed?.images ?? [];

    pages.push({
      url: item.url,
      finalUrl: outcome.finalUrl,
      statusCode: reportedStatus,
      statusText: reportedStatusText,
      contentType,
      isHtml,

      indexable,
      indexabilityStatus: status,

      title: parsed?.title ?? null,
      titleLength: parsed?.title ? parsed.title.length : 0,
      metaDescription: parsed?.metaDescription ?? null,
      metaDescriptionLength: parsed?.metaDescription ? parsed.metaDescription.length : 0,
      h1: parsed?.h1 ?? [],
      h2: parsed?.h2 ?? [],

      canonical: parsed?.canonical ?? null,
      canonicalResolved,
      isSelfCanonical,

      metaRobots: parsed?.metaRobots ?? null,
      xRobotsTag: outcome.headers['x-robots-tag'] ?? null,
      noindex,
      nofollowPage,

      hreflang: parsed?.hreflang ?? [],
      lang: parsed?.lang ?? null,

      wordCount: parsed?.wordCount ?? 0,
      textRatio: parsed?.textRatio ?? 0,

      depth: item.depth,
      inlinks: 0,
      uniqueInlinks: 0,
      linkedFrom: [],
      outlinks: internalLinks.length + externalLinks.length,
      externalOutlinks: externalLinks.length,
      nofollowOutlinks: [...internalLinks, ...externalLinks].filter((l) => l.nofollow).length,
      internalLinks,
      externalLinks,

      redirectChain: outcome.redirectChain,
      redirectTarget:
        outcome.redirectChain.length > 0 ? outcome.finalUrl : null,
      redirectLoop: outcome.redirectLoop,

      responseTimeMs: outcome.responseTimeMs,
      sizeBytes: outcome.bytes,

      images,
      imagesMissingAlt: images.filter((img) => !img.hasAltAttribute).length,

      structuredData: parsed?.structuredData ?? [],
      structuredDataTypes: [...new Set((parsed?.structuredData ?? []).flatMap((b) => b.types))],
      structuredDataErrors: (parsed?.structuredData ?? []).flatMap((b) => b.errors),

      inSitemap: sitemapSet.has(item.url),
      isOrphan: false,

      https: item.url.startsWith('https://'),
      mixedContent: parsed?.mixedContent ?? [],
      hasViewport: parsed?.hasViewport ?? false,
      ogTitle: parsed?.ogTitle ?? null,
      ogImage: parsed?.ogImage ?? null,
      securityHeaders: pickSecurityHeaders(outcome.headers),

      contentHash: parsed?.contentHash ?? '',
      content: parsed?.content ?? null,

      fetchError: outcome.error,
    });
  }

  function buildBlockedPage(item: QueueItem, inSitemap: boolean): CrawledUrl {
    return {
      url: item.url,
      finalUrl: item.url,
      statusCode: 0,
      statusText: 'Blocked by robots.txt',
      contentType: '',
      isHtml: false,
      indexable: false,
      indexabilityStatus: 'Blocked by robots.txt',
      title: null,
      titleLength: 0,
      metaDescription: null,
      metaDescriptionLength: 0,
      h1: [],
      h2: [],
      canonical: null,
      canonicalResolved: null,
      isSelfCanonical: false,
      metaRobots: null,
      xRobotsTag: null,
      noindex: false,
      nofollowPage: false,
      hreflang: [],
      lang: null,
      wordCount: 0,
      textRatio: 0,
      depth: item.depth,
      inlinks: 0,
      uniqueInlinks: 0,
      linkedFrom: [],
      outlinks: 0,
      externalOutlinks: 0,
      nofollowOutlinks: 0,
      internalLinks: [],
      externalLinks: [],
      redirectChain: [],
      redirectTarget: null,
      redirectLoop: false,
      responseTimeMs: 0,
      sizeBytes: 0,
      images: [],
      imagesMissingAlt: 0,
      structuredData: [],
      structuredDataTypes: [],
      structuredDataErrors: [],
      inSitemap,
      isOrphan: false,
      https: item.url.startsWith('https://'),
      mixedContent: [],
      hasViewport: false,
      ogTitle: null,
      ogImage: null,
      securityHeaders: {},
      contentHash: '',
      content: null,
      fetchError: null,
    };
  }

  // ── BFS a ondate: ogni ondata rispetta la concorrenza e il delay configurati ──
  while (queue.length > 0 && pages.length < config.maxUrls) {
    if (hooks.shouldStop?.()) {
      stopped = true;
      warnings.push('Crawl interrotto su richiesta.');
      break;
    }

    const batchSize = Math.min(config.concurrency, config.maxUrls - pages.length, queue.length);
    const batch = queue.splice(0, batchSize);

    hooks.onProgress?.({
      crawled: pages.length,
      queued: queue.length,
      currentUrl: batch[0]?.url ?? '',
    });

    await Promise.all(
      batch.map(async (item) => {
        try {
          await processOne(item);
        } catch (err) {
          logger.warn({ url: item.url, err }, 'Errore imprevisto durante il crawl della URL');
        }
      }),
    );

    if (config.delayMs > 0) await sleep(config.delayMs);
  }

  if (queue.length > 0 && !stopped) {
    limitReached = 'maxUrls';
    warnings.push(
      `Limite di ${config.maxUrls} URL raggiunto: ${queue.length} URL erano ancora in coda. ` +
        'I risultati sono rappresentativi ma non esaustivi.',
    );
  }

  // ── Seconda passata: URL presenti in sitemap ma mai raggiunte da un link interno ──
  if (!stopped && pages.length < config.maxUrls) {
    const crawled = new Set(pages.map((p) => p.url));
    const orphanCandidates = sitemap.urls.filter((url) => !crawled.has(url)).slice(0, Math.max(0, config.maxUrls - pages.length));

    for (const url of orphanCandidates) {
      const parsedUrl = safeParseUrl(url);
      if (!parsedUrl || !inScope(parsedUrl)) continue;
      if (seen.has(url) && crawled.has(url)) continue;
      seen.add(url);
      queue.push({ url, depth: 0, source: 'sitemap' });
    }

    while (queue.length > 0 && pages.length < config.maxUrls) {
      if (hooks.shouldStop?.()) break;
      const batchSize = Math.min(config.concurrency, config.maxUrls - pages.length, queue.length);
      const batch = queue.splice(0, batchSize);
      hooks.onProgress?.({
        crawled: pages.length,
        queued: queue.length,
        currentUrl: batch[0]?.url ?? '',
      });
      await Promise.all(
        batch.map(async (item) => {
          try {
            await processOne(item);
          } catch (err) {
            logger.warn({ url: item.url, err }, 'Errore imprevisto durante il crawl della URL');
          }
        }),
      );
      if (config.delayMs > 0) await sleep(config.delayMs);
    }
  }

  // ── Consolidamento: inlink, orfane, profondità ──
  for (const page of pages) {
    page.inlinks = inlinks.get(page.url) ?? 0;
    const sources = uniqueInlinkSources.get(page.url);
    page.uniqueInlinks = sources?.size ?? 0;
    page.linkedFrom = sources ? [...sources].slice(0, 5) : [];
    page.isOrphan =
      page.uniqueInlinks === 0 &&
      page.url !== startNormalized &&
      page.isHtml &&
      !redirectTargets.has(page.url);
  }

  const finishedAt = new Date();

  return {
    config,
    rootUrl: root.toString(),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    pages,
    robots: robots.info,
    sitemap,
    limitReached,
    warnings,
  };
}

function pickSecurityHeaders(headers: Record<string, string>): Record<string, string> {
  const keys = [
    'strict-transport-security',
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
  ];
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = headers[key];
    if (value) out[key] = value;
  }
  return out;
}
