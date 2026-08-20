import type { ContentAnalysis } from '../content';

export interface CrawlConfig {
  /** URL di partenza, già normalizzata. */
  startUrl: string;
  maxUrls: number;
  maxDepth: number;
  concurrency: number;
  delayMs: number;
  timeoutMs: number;
  respectRobots: boolean;
  includeSubdomains: boolean;
  userAgent: string;
  /** Regex (stringhe) applicate alla URL completa. */
  include: string[];
  exclude: string[];
  /** Sitemap dichiarata esplicitamente; se assente si usano robots.txt e i percorsi standard. */
  sitemapUrl?: string;
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface ImageRef {
  src: string;
  alt: string | null;
  /** L’attributo alt è presente (anche se vuoto: alt="" è valido per le immagini decorative). */
  hasAltAttribute: boolean;
  width: string | null;
  height: string | null;
  loading: string | null;
}

export interface HreflangRef {
  lang: string;
  href: string;
}

export interface StructuredDataEntity {
  type: string;
  /** Nomi delle proprietà dichiarate su quell'entità, senza i valori. */
  properties: string[];
  /** L'entità ha un @id, quindi è referenziabile dalle altre entità del sito. */
  hasId: boolean;
}

export interface StructuredDataBlock {
  format: 'json-ld' | 'microdata' | 'rdfa';
  types: string[];
  /** Entità estratte dal blocco, anche annidate: serve per validarne le proprietà. */
  entities: StructuredDataEntity[];
  errors: string[];
}

export interface LinkRef {
  url: string;
  anchor: string;
  rel: string | null;
  nofollow: boolean;
}

export type IndexabilityStatus =
  | 'Indexable'
  | 'Noindex'
  | 'Canonicalised'
  | 'Blocked by robots.txt'
  | 'Redirect'
  | 'Client Error'
  | 'Server Error'
  | 'Non-HTML'
  | 'Fetch Error';

export interface CrawledUrl {
  url: string;
  finalUrl: string;
  statusCode: number;
  statusText: string;
  contentType: string;
  isHtml: boolean;

  indexable: boolean;
  indexabilityStatus: IndexabilityStatus;

  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  h1: string[];
  h2: string[];

  canonical: string | null;
  canonicalResolved: string | null;
  isSelfCanonical: boolean;

  metaRobots: string | null;
  xRobotsTag: string | null;
  noindex: boolean;
  nofollowPage: boolean;

  hreflang: HreflangRef[];
  lang: string | null;

  wordCount: number;
  textRatio: number;

  depth: number;
  inlinks: number;
  /**
   * Fino a 5 pagine che linkano questa URL. Serve a rendere le issue azionabili:
   * "questa URL è rotta" dice il problema, "è linkata da /contatti" dice dove correggerlo.
   */
  linkedFrom: string[];
  uniqueInlinks: number;
  outlinks: number;
  externalOutlinks: number;
  nofollowOutlinks: number;
  internalLinks: LinkRef[];
  externalLinks: LinkRef[];

  redirectChain: RedirectHop[];
  redirectTarget: string | null;
  redirectLoop: boolean;

  responseTimeMs: number;
  sizeBytes: number;

  images: ImageRef[];
  imagesMissingAlt: number;

  structuredData: StructuredDataBlock[];
  structuredDataTypes: string[];
  structuredDataErrors: string[];

  inSitemap: boolean;
  isOrphan: boolean;

  https: boolean;
  mixedContent: string[];
  hasViewport: boolean;
  ogTitle: string | null;
  ogImage: string | null;
  securityHeaders: Record<string, string>;

  /** Contenuto testuale normalizzato: usato per duplicati e thin content. Non finisce nel report. */
  contentHash: string;

  /**
   * Analisi semantica del testo: keyword, collocazione della keyword principale,
   * leggibilità e gerarchia degli heading. Null sulle pagine non HTML o non analizzabili.
   */
  content: ContentAnalysis | null;

  fetchError: string | null;
}

export interface RobotsInfo {
  url: string;
  found: boolean;
  statusCode: number;
  content: string;
  sitemaps: string[];
  blocksEverything: boolean;
  error: string | null;
}

export interface SitemapInfo {
  urls: string[];
  sources: string[];
  errors: string[];
  found: boolean;
}

export interface CrawlProgress {
  crawled: number;
  queued: number;
  currentUrl: string;
}

export interface CrawlResult {
  config: CrawlConfig;
  rootUrl: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  pages: CrawledUrl[];
  robots: RobotsInfo;
  sitemap: SitemapInfo;
  /** Vincoli raggiunti durante il crawl: servono a segnalare che il campione è parziale. */
  limitReached: 'maxUrls' | 'maxDepth' | null;
  warnings: string[];
}
