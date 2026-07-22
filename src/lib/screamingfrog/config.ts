import { z } from "zod";

/**
 * User-facing crawl configuration. Translated into CLI flags by the provider.
 * Kept transport-agnostic: no CLI string lives in application code.
 */
export const crawlConfigSchema = z.object({
  maxUrls: z.coerce.number().int().positive().max(5_000_000).optional(),
  maxDepth: z.coerce.number().int().min(0).max(50).optional(),
  includePatterns: z.array(z.string()).default([]),
  excludePatterns: z.array(z.string()).default([]),
  respectRobots: z.boolean().default(true),
  crawlSubdomains: z.boolean().default(false),
  jsRendering: z.boolean().default(false),
  userAgent: z.string().optional(),
  // Screaming Frog speed control: max URLs/sec (0 = unlimited) and/or threads.
  maxUrlsPerSecond: z.coerce.number().min(0).optional(),
  maxThreads: z.coerce.number().int().min(1).max(50).optional(),
  // Sitemap(s) to crawl / include in the analysis.
  sitemapUrls: z.array(z.string()).default([]),
  crawlSitemap: z.boolean().default(true),
  // Path to a custom .seospiderconfig file (overrides individual flags).
  customConfigPath: z.string().optional(),
});

export type CrawlConfig = z.infer<typeof crawlConfigSchema>;

export const defaultCrawlConfig: CrawlConfig = {
  includePatterns: [],
  excludePatterns: [],
  respectRobots: true,
  crawlSubdomains: false,
  jsRendering: false,
  sitemapUrls: [],
  crawlSitemap: true,
};
