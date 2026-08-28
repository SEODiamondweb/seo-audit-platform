import robotsParser from 'robots-parser';
import { fetchUrl } from './fetcher';
import type { RobotsInfo } from './types';

export interface RobotsChecker {
  info: RobotsInfo;
  isAllowed(url: string): boolean;
}

function extractSitemaps(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (match && match[1]) out.push(match[1].trim());
  }
  return [...new Set(out)];
}

export async function loadRobots(
  rootUrl: string,
  userAgent: string,
  timeoutMs: number,
): Promise<RobotsChecker> {
  const robotsUrl = new URL('/robots.txt', rootUrl).toString();
  const outcome = await fetchUrl(robotsUrl, { userAgent, timeoutMs });

  const found = outcome.status === 200 && outcome.body.trim().length > 0;
  const content = found ? outcome.body : '';
  const sitemaps = found ? extractSitemaps(content) : [];

  const info: RobotsInfo = {
    url: robotsUrl,
    found,
    statusCode: outcome.status,
    content,
    sitemaps,
    blocksEverything: false,
    error: outcome.error,
  };

  if (!found) {
    // Nessun robots.txt valido: per convenzione tutto è consentito.
    return { info, isAllowed: () => true };
  }

  const parser = robotsParser(robotsUrl, content);
  info.blocksEverything = parser.isDisallowed(new URL('/', rootUrl).toString(), userAgent) === true;

  return {
    info,
    isAllowed(url: string): boolean {
      // `isAllowed` può restituire undefined quando non ci sono direttive applicabili.
      return parser.isAllowed(url, userAgent) !== false;
    },
  };
}
