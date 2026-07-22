// Shared domain types for the audit engine. Deliberately decoupled from Prisma
// so rules can be unit-tested against plain objects.

export type IssueCategory =
  | "CRAWLABILITY"
  | "STATUS_CODE"
  | "REDIRECT"
  | "CANONICAL"
  | "METADATA"
  | "HEADING"
  | "CONTENT"
  | "INTERNAL_LINKING"
  | "IMAGES"
  | "SITEMAP"
  | "ROBOTS"
  | "HREFLANG"
  | "STRUCTURED_DATA"
  | "PERFORMANCE"
  | "SECURITY";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type Effort = "TRIVIAL" | "LOW" | "MEDIUM" | "HIGH";

/** Loose record matching CrawledUrl fields (post-import). */
export interface UrlRecord {
  url: string;
  contentType?: string | null;
  statusCode?: number | null;
  indexability?: "INDEXABLE" | "NON_INDEXABLE" | "UNKNOWN" | null;
  indexabilityStatus?: string | null;
  title?: string | null;
  titleLength?: number | null;
  metaDescription?: string | null;
  metaDescriptionLength?: number | null;
  h1?: string | null;
  h2?: string | null;
  canonical?: string | null;
  metaRobots?: string | null;
  hreflang?: string | null;
  wordCount?: number | null;
  crawlDepth?: number | null;
  inlinks?: number | null;
  outlinks?: number | null;
  redirectUrl?: string | null;
  responseTimeMs?: number | null;
  images?: number | null;
  imagesMissingAlt?: number | null;
  structuredData?: boolean | null;
  structuredDataTypes?: string | null;
  inSitemap?: boolean | null;
  rawIssues?: string[] | null;
}

export interface IssueMatch {
  url: string;
  evidence?: string;
}

/** Output of a rule for a given dataset. */
export interface GeneratedIssue {
  ruleKey: string;
  title: string;
  category: IssueCategory;
  severity: Severity;
  priority: Priority;
  description: string;
  seoImpact: string;
  recommendation: string;
  effort: Effort;
  matches: IssueMatch[];
  evidence?: Record<string, unknown>;
}

export interface Rule {
  key: string;
  title: string;
  category: IssueCategory;
  severity: Severity;
  priority: Priority;
  effort: Effort;
  description: string;
  seoImpact: string;
  recommendation: string;
  /** Return the matching URLs (with optional per-URL evidence). */
  evaluate: (urls: UrlRecord[]) => IssueMatch[];
}
