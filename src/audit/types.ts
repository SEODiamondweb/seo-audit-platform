import type { CrawlResult, CrawledUrl } from '../crawler/types';
import type { PageSpeedResult } from '../pagespeed';
import type { CrawlerLogReport } from '../crawlers/report';
import type { GscReport } from '../gsc';

export const CATEGORIES = [
  'crawling_indexing',
  'status_codes',
  'redirects',
  'canonical',
  'metadata',
  'headings',
  'content',
  'internal_linking',
  'images',
  'sitemap',
  'robots_txt',
  'hreflang',
  'structured_data',
  'performance',
  'security',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  crawling_indexing: 'Scansione e indicizzazione',
  status_codes: 'Status code',
  redirects: 'Redirect',
  canonical: 'Canonical',
  metadata: 'Metadata',
  headings: 'Heading',
  content: 'Contenuti',
  internal_linking: 'Linking interno',
  images: 'Immagini',
  sitemap: 'Sitemap',
  robots_txt: 'Robots.txt',
  hreflang: 'Hreflang',
  structured_data: 'Dati strutturati',
  performance: 'Performance',
  security: 'Sicurezza',
};

/**
 * Peso di ogni categoria sul punteggio finale. La somma è esattamente 100:
 * ogni categoria può erodere al massimo il proprio peso.
 */
export const CATEGORY_WEIGHTS: Record<Category, number> = {
  crawling_indexing: 13,
  status_codes: 8,
  redirects: 6,
  canonical: 7,
  metadata: 9,
  headings: 6,
  content: 10,
  internal_linking: 7,
  images: 5,
  sitemap: 5,
  robots_txt: 4,
  hreflang: 4,
  structured_data: 4,
  performance: 7,
  security: 5,
};

// Somma verificata a runtime: un peso sbagliato produrrebbe punteggi fuori scala in silenzio.
const WEIGHT_SUM = Object.values(CATEGORY_WEIGHTS).reduce((acc, w) => acc + w, 0);
if (WEIGHT_SUM !== 100) {
  throw new Error(`I pesi delle categorie devono sommare a 100, trovato ${WEIGHT_SUM}`);
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type Effort = 'low' | 'medium' | 'high';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'wont_fix';

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critica',
  high: 'Alta',
  medium: 'Media',
  low: 'Bassa',
  info: 'Informativa',
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** Quota di peso di categoria che una singola issue può erodere, a copertura piena. */
export const SEVERITY_IMPACT: Record<Severity, number> = {
  critical: 1,
  high: 0.6,
  medium: 0.3,
  low: 0.12,
  info: 0,
};

export const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Basso',
  medium: 'Medio',
  high: 'Alto',
};

export interface IssueUrl {
  url: string;
  /** Dato concreto che dimostra il problema su quella URL (valore trovato, atteso, ecc.). */
  evidence: string;
}

export interface AuditIssue {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  priority: Priority;
  description: string;
  seoImpact: string;
  recommendation: string;
  effort: Effort;
  status: IssueStatus;
  assignee: string | null;
  urls: IssueUrl[];
  affectedCount: number;
  /** Quota di pagine analizzate coinvolte, 0..1 */
  affectedRatio: number;
  /** Penalità effettivamente applicata al punteggio (punti su 100). */
  scorePenalty: number;
}

export interface RuleFinding {
  urls: IssueUrl[];
  /** Sovrascrive la severità di default della regola (es. escalation se la copertura è totale). */
  severityOverride?: Severity;
  /** Denominatore alternativo per il calcolo della copertura (es. solo le pagine HTML). */
  scopeSize?: number;
  /** Testo aggiuntivo accodato alla descrizione. */
  note?: string;
}

export interface Rule {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  effort: Effort;
  description: string;
  seoImpact: string;
  recommendation: string;
  evaluate(ctx: AuditContext): RuleFinding | null;
}

export interface AuditContext {
  crawl: CrawlResult;
  /** Tutte le pagine restituite dal crawl. */
  pages: CrawledUrl[];
  /** Solo pagine HTML con risposta 2xx: il perimetro su cui ha senso valutare il contenuto. */
  htmlPages: CrawledUrl[];
  /** Sottoinsieme di htmlPages effettivamente indicizzabile. */
  indexablePages: CrawledUrl[];
  pagesByUrl: Map<string, CrawledUrl>;
  totalPages: number;
  /** Misurazione PageSpeed Insights della home, se disponibile. */
  pagespeed: PageSpeedResult | null;
  /** Analisi dei crawler dai log del server, se l’utente li ha forniti. */
  crawlers: CrawlerLogReport | null;
  /** Dati Search Console, se il service account è configurato. */
  gsc: GscReport | null;
}

export interface CategoryScore {
  category: Category;
  label: string;
  weight: number;
  penalty: number;
  /** 0..100, salute della singola categoria. */
  score: number;
  issueCount: number;
}

export interface AuditScore {
  total: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  categories: CategoryScore[];
}

export interface AuditSummary {
  totalPages: number;
  htmlPages: number;
  indexablePages: number;
  nonIndexablePages: number;
  brokenPages: number;
  redirects: number;
  serverErrors: number;
  avgResponseTimeMs: number;
  avgWordCount: number;
  maxDepth: number;
  orphanPages: number;
  sitemapUrls: number;
  /** URL immagine distinte trovate sul sito, non occorrenze nelle pagine. */
  totalImages: number;
  /** Di quelle, quante compaiono senza attributo alt in almeno un punto. */
  imagesMissingAlt: number;
  issuesBySeverity: Record<Severity, number>;
  issuesByPriority: Record<Priority, number>;
}

export interface AuditResult {
  id: string;
  domain: string;
  rootUrl: string;
  createdAt: string;
  crawl: CrawlResult;
  score: AuditScore;
  issues: AuditIssue[];
  summary: AuditSummary;
  pagespeed: PageSpeedResult | null;
  crawlers: CrawlerLogReport | null;
  gsc: GscReport | null;
  requestedBy?: string;
}
