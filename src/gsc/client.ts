import { registrableHost } from '../utils/url';
import type { GscAccount } from './auth';

/**
 * Client minimale per le API di Search Console.
 *
 * Tre endpoint, tutti in sola lettura:
 *  - sites: le proprietà visibili a un service account;
 *  - searchAnalytics: click, impression, CTR e posizione per pagina e per query;
 *  - urlInspection: lo stato di indicizzazione di una URL secondo Google, inclusa la data
 *    dell'ultima scansione di Googlebot — il dato più diretto possibile su "quando Google
 *    ha visto questa pagina".
 */

const WEBMASTERS = 'https://www.googleapis.com/webmasters/v3';
const SEARCHCONSOLE = 'https://searchconsole.googleapis.com/v1';

async function call<T>(account: GscAccount, url: string, body?: unknown): Promise<T> {
  const token = await account.getAccessToken();

  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error('GSC HTTP ' + response.status + ': ' + text.slice(0, 250));
  }
  return (await response.json()) as T;
}

export interface PropertyRef {
  siteUrl: string;
  permissionLevel: string;
  /** Il service account attraverso cui questa proprietà è raggiungibile. */
  account: GscAccount;
}

/** Le proprietà visibili a un service account, escluse quelle senza permessi utili. */
export async function listProperties(account: GscAccount): Promise<PropertyRef[]> {
  const { siteEntry } = await call<{
    siteEntry?: { siteUrl: string; permissionLevel: string }[];
  }>(account, WEBMASTERS + '/sites');

  return (siteEntry ?? [])
    .filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
    .map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel, account }));
}

/**
 * Sceglie fra le proprietà disponibili quella che corrisponde al dominio.
 *
 * Il criterio è volutamente severo: meglio nessun dato che dati di un'altra proprietà.
 * - una proprietà Dominio (sc-domain:) corrisponde se copre il dominio richiesto,
 *   perché per definizione include tutti i sottodomini e i protocolli;
 * - una proprietà URL corrisponde solo se l'host è lo stesso, al netto del www:
 *   https://shop.example.com NON vale per un audit di example.com, perché conterrebbe
 *   solo i dati dello shop e sembrerebbero quelli del sito.
 */
export function matchProperty(domain: string, properties: PropertyRef[]): PropertyRef | null {
  const bare = domain.toLowerCase().replace(/^www\./, '');
  const wanted = registrableHost(domain);

  const domainProperty = properties.find(
    (p) => p.siteUrl === 'sc-domain:' + wanted || p.siteUrl === 'sc-domain:' + bare,
  );
  if (domainProperty) return domainProperty;

  return (
    properties.find((p) => {
      try {
        return new URL(p.siteUrl).hostname.toLowerCase().replace(/^www\./, '') === bare;
      } catch {
        return false;
      }
    }) ?? null
  );
}

export interface SearchRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function querySearchAnalytics(
  property: PropertyRef,
  dimension: 'page' | 'query',
  startDate: string,
  endDate: string,
  rowLimit = 100,
): Promise<SearchRow[]> {
  const result = await call<{ rows?: SearchRow[] }>(
    property.account,
    WEBMASTERS + '/sites/' + encodeURIComponent(property.siteUrl) + '/searchAnalytics/query',
    { startDate, endDate, dimensions: [dimension], rowLimit },
  );
  return result.rows ?? [];
}

export interface InspectionResult {
  url: string;
  /** PASS, NEUTRAL, FAIL... il verdetto sintetico di Google. */
  verdict: string;
  /** Es. "Submitted and indexed", "Crawled - currently not indexed". */
  coverageState: string;
  /** Ultima scansione di Googlebot, ISO. Null se Google non l'ha mai vista. */
  lastCrawlTime: string | null;
  robotsTxtState: string;
  indexingState: string;
  googleCanonical: string | null;
}

export async function inspectUrl(property: PropertyRef, url: string): Promise<InspectionResult> {
  interface Raw {
    inspectionResult?: {
      indexStatusResult?: {
        verdict?: string;
        coverageState?: string;
        lastCrawlTime?: string;
        robotsTxtState?: string;
        indexingState?: string;
        googleCanonical?: string;
      };
    };
  }
  const raw = await call<Raw>(property.account, SEARCHCONSOLE + '/urlInspection/index:inspect', {
    inspectionUrl: url,
    siteUrl: property.siteUrl,
  });

  const status = raw.inspectionResult?.indexStatusResult ?? {};
  return {
    url,
    verdict: status.verdict ?? 'VERDICT_UNSPECIFIED',
    coverageState: status.coverageState ?? '—',
    // Google usa una data epoca ("1970-01-01...") per "mai scansionata".
    lastCrawlTime:
      status.lastCrawlTime && !status.lastCrawlTime.startsWith('1970-')
        ? status.lastCrawlTime
        : null,
    robotsTxtState: status.robotsTxtState ?? '—',
    indexingState: status.indexingState ?? '—',
    googleCanonical: status.googleCanonical ?? null,
  };
}
