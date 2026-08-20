import { XMLParser } from 'fast-xml-parser';
import { fetchUrl } from './fetcher';
import { normalizeUrl } from '../utils/url';
import type { SitemapInfo } from './types';

const MAX_SITEMAPS = 25;
const MAX_URLS = 50000;

interface SitemapEntry {
  loc?: string;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function readLoc(entry: unknown): string | null {
  if (typeof entry === 'string') return entry.trim();
  if (entry && typeof entry === 'object') {
    const loc = (entry as SitemapEntry).loc;
    if (typeof loc === 'string') return loc.trim();
    if (typeof loc === 'number') return String(loc);
  }
  return null;
}

export interface SitemapCandidate {
  url: string;
  /**
   * true se la sitemap è dichiarata dal sito (robots.txt, opzione --sitemap) o referenziata
   * da un sitemapindex valido; false se stiamo solo tentando un percorso convenzionale.
   *
   * Distinzione necessaria: un 404 su /wp-sitemap.xml provato alla cieca non è un problema
   * del sito e non deve finire nel report, mentre un 404 su una sitemap dichiarata sì.
   */
  declared: boolean;
}

/**
 * Scarica e appiattisce le sitemap, seguendo gli indici (sitemapindex) fino a MAX_SITEMAPS file.
 * Gli errori vengono registrati solo per le sitemap dichiarate: vedi `SitemapCandidate.declared`.
 */
export async function loadSitemaps(
  rootUrl: string,
  candidates: SitemapCandidate[],
  userAgent: string,
  timeoutMs: number,
): Promise<SitemapInfo> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
  });

  const queue: SitemapCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate.url, rootUrl);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      queue.push({ url: normalized, declared: candidate.declared });
    }
  }

  const urls = new Set<string>();
  const sources: string[] = [];
  const errors: string[] = [];
  let processed = 0;

  while (queue.length > 0 && processed < MAX_SITEMAPS && urls.size < MAX_URLS) {
    const candidate = queue.shift() as SitemapCandidate;
    const current = candidate.url;
    processed++;

    /** Registra l'errore solo se la sitemap era attesa: altrimenti è rumore da probing. */
    const fail = (message: string): void => {
      if (candidate.declared) errors.push(`${current}: ${message}`);
    };

    const outcome = await fetchUrl(current, { userAgent, timeoutMs });
    if (outcome.error) {
      fail(outcome.error);
      continue;
    }
    if (outcome.status !== 200) {
      fail(`HTTP ${outcome.status}`);
      continue;
    }
    if (!outcome.body.trim()) {
      fail('risposta vuota');
      continue;
    }

    // Sitemap in formato testo semplice (una URL per riga).
    if (!outcome.body.trimStart().startsWith('<')) {
      const lines = outcome.body
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^https?:\/\//i.test(l));
      if (lines.length === 0) {
        fail('formato non riconosciuto');
        continue;
      }
      sources.push(current);
      for (const line of lines) {
        const normalized = normalizeUrl(line);
        if (normalized) urls.add(normalized);
      }
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parser.parse(outcome.body) as Record<string, unknown>;
    } catch (err) {
      fail(`XML non valido (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }

    const index = parsed['sitemapindex'] as Record<string, unknown> | undefined;
    if (index) {
      sources.push(current);
      for (const node of asArray(index['sitemap'] as unknown)) {
        const loc = readLoc(node);
        if (!loc) continue;
        const normalized = normalizeUrl(loc, current);
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          // Referenziata da un indice valido: da qui in poi un errore è un errore vero.
          queue.push({ url: normalized, declared: true });
        }
      }
      continue;
    }

    const urlset = parsed['urlset'] as Record<string, unknown> | undefined;
    if (urlset) {
      sources.push(current);
      for (const node of asArray(urlset['url'] as unknown)) {
        const loc = readLoc(node);
        if (!loc) continue;
        const normalized = normalizeUrl(loc, current);
        if (normalized) urls.add(normalized);
        if (urls.size >= MAX_URLS) break;
      }
      continue;
    }

    // Risposta 200 che non è una sitemap: capita di frequente sui percorsi tentati alla cieca,
    // dove il server serve la pagina 404 con status 200. Non va contata fra le sitemap trovate.
    fail('nessun <urlset> o <sitemapindex> trovato');
  }

  return {
    urls: [...urls],
    sources,
    errors,
    found: sources.length > 0,
  };
}

export function defaultSitemapCandidates(rootUrl: string): string[] {
  return [
    new URL('/sitemap.xml', rootUrl).toString(),
    new URL('/sitemap_index.xml', rootUrl).toString(),
    new URL('/sitemap-index.xml', rootUrl).toString(),
    new URL('/wp-sitemap.xml', rootUrl).toString(),
  ];
}
