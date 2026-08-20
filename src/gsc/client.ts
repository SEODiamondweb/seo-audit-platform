import { getAccessToken } from './auth';
import { registrableHost } from '../utils/url';

/**
 * Client minimale per le API di Search Console.
 *
 * Tre endpoint, tutti in sola lettura:
 *  - sites: per individuare la proprietà giusta fra quelle a cui il service account ha accesso;
 *  - searchAnalytics: click, impression, CTR e posizione per pagina e per query;
 *  - urlInspection: lo stato di indicizzazione di una URL secondo Google, inclusa la data
 *    dell'ultima scansione di Googlebot — il dato più diretto possibile su "quando Google
 *    ha visto questa pagina".
 */

const WEBMASTERS = 'https://www.googleapis.com/webmasters/v3';
const SEARCHCONSOLE = 'https://searchconsole.googleapis.com/v1';

async function call<T>(url: string, body?: unknown): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error('Service account non configurato');

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

export interface PropertyLookup {
  /** La proprietà scelta, o null se nessuna corrisponde davvero al dominio. */
  property: string | null;
  /** Tutte le proprietà a cui il service account ha accesso: servono a diagnosticare
   *  un mancato match ("il collegamento funziona, manca l'aggiunta su questa proprietà"). */
  available: string[];
}

/**
 * Trova la proprietà Search Console corrispondente al dominio.
 *
 * Il criterio è volutamente severo: meglio nessun dato che dati di un'altra proprietà.
 * - una proprietà Dominio (sc-domain:) corrisponde se copre il dominio richiesto,
 *   perché per definizione include tutti i sottodomini e i protocolli;
 * - una proprietà URL corrisponde solo se l'host è lo stesso (al netto del www):
 *   https://shop.example.com NON vale per un audit di example.com — conterrebbe
 *   solo i dati dello shop e sembrerebbero i dati del sito.
 */
export async function resolveProperty(domain: string): Promise<PropertyLookup> {
  const { siteEntry } = await call<{
    siteEntry?: { siteUrl: string; permissionLevel: string }[];
  }>(WEBMASTERS + '/sites');

  const usable = (siteEntry ?? []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser');
  const available = usable.map((s) => s.siteUrl).sort();

  const bare = domain.toLowerCase().replace(/^www\./, '');
  const wanted = registrableHost(domain);

  const domainProperty = usable.find(
    (s) => s.siteUrl === 'sc-domain:' + wanted || s.siteUrl === 'sc-domain:' + bare,
  );
  if (domainProperty) return { property: domainProperty.siteUrl, available };

  const sameHost = (host: string): boolean => {
    const h = host.toLowerCase().replace(/^www\./, '');
    return h === bare;
  };
  const urlProperty = usable.find((s) => {
    try {
      return sameHost(new URL(s.siteUrl).hostname);
    } catch {
      return false;
    }
  });
  return { property: urlProperty?.siteUrl ?? null, available };
}

export interface SearchRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function querySearchAnalytics(
  property: string,
  dimension: 'page' | 'query',
  startDate: string,
  endDate: string,
  rowLimit = 100,
): Promise<SearchRow[]> {
  const result = await call<{ rows?: SearchRow[] }>(
    WEBMASTERS + '/sites/' + encodeURIComponent(property) + '/searchAnalytics/query',
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

export async function inspectUrl(property: string, url: string): Promise<InspectionResult> {
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
  const raw = await call<Raw>(SEARCHCONSOLE + '/urlInspection/index:inspect', {
    inspectionUrl: url,
    siteUrl: property,
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
