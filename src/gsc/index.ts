import { logger } from '../utils/logger';
import { credentialPaths, hasAnyAccount, loadAccounts } from './auth';
import { inspectUrl, listProperties, matchProperty, querySearchAnalytics } from './client';
import { loadGscLinks } from './links';
import type { InspectionResult, PropertyRef, SearchRow } from './client';
import type { GscLinksReport } from './links';

export type { InspectionResult, SearchRow, PropertyRef } from './client';
export type { GscLinksReport, LinkingSite, LinkedPage } from './links';
export { credentialPaths, hasAnyAccount, loadAccounts } from './auth';
export type { GscAccount, AccountKind } from './auth';
export { listProperties, matchProperty } from './client';

/** Quante pagine ispezionare con la URL Inspection API (limite Google: 2000/giorno). */
const INSPECTION_SAMPLE = 15;

export interface GscReport {
  /** Proprietà usata, vuota se nessuna corrisponde al dominio. */
  property: string;
  /** Email dell’account attraverso cui la proprietà è stata raggiunta. */
  viaAccount: string;
  /** Periodo dei dati di ricerca, ISO date. */
  periodStart: string;
  periodEnd: string;
  totalClicks: number;
  totalImpressions: number;
  topPages: SearchRow[];
  topQueries: SearchRow[];
  /** Stato di indicizzazione e ultima scansione Google di un campione di pagine. */
  inspections: InspectionResult[];
  links: GscLinksReport | null;
  /** Tutte le proprietà viste, da tutti gli account: diagnostica del mancato match. */
  availableProperties: string[];
  errors: string[];
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function emptyReport(overrides: Partial<GscReport>): GscReport {
  return {
    property: '',
    viaAccount: '',
    periodStart: '',
    periodEnd: '',
    totalClicks: 0,
    totalImpressions: 0,
    topPages: [],
    topQueries: [],
    inspections: [],
    links: null,
    availableProperties: [],
    errors: [],
    ...overrides,
  };
}

/**
 * Raccoglie tutte le proprietà visibili, attraverso tutte le chiavi configurate.
 *
 * Gli account collegati via OAuth e gli eventuali service account concorrono insieme:
 * le proprietà raggiungibili si sommano, e ogni proprietà ricorda da quale identità
 * è stata vista, così il report può dirlo.
 */
export async function collectProperties(): Promise<{
  properties: PropertyRef[];
  errors: string[];
}> {
  const { accounts, errors: loadErrors } = await loadAccounts();
  const errors = loadErrors.map((e) => e.source + ': ' + e.reason);
  const properties: PropertyRef[] = [];

  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        return await listProperties(account);
      } catch (err) {
        errors.push(
          'Proprietà di ' + account.email + ': ' + (err instanceof Error ? err.message : String(err)),
        );
        return [] as PropertyRef[];
      }
    }),
  );

  for (const list of results) properties.push(...list);
  return { properties, errors };
}

/**
 * Raccoglie i dati Search Console per il dominio.
 *
 * Ritorna null solo quando l'integrazione non è configurata affatto e non ci sono nemmeno
 * export dei link: in ogni altro caso ritorna un report, anche vuoto, perché "collegato ma
 * proprietà non trovata" è un'informazione che va comunicata, non taciuta.
 */
export async function collectGscData(
  domain: string,
  candidateUrls: string[],
): Promise<GscReport | null> {
  const links = await loadGscLinks(domain);
  const configured = await hasAnyAccount();

  if (!configured) {
    if (!links) return null;
    return emptyReport({
      links,
      errors: [
        'Nessun account Google collegato: disponibili solo gli export del report Link. ' +
          'Collega un account con: npm run gsc:login',
      ],
    });
  }

  const { properties, errors } = await collectProperties();
  const availableProperties = properties.map((p) => p.siteUrl).sort();
  const property = matchProperty(domain, properties);

  if (!property) {
    return emptyReport({
      links,
      availableProperties,
      errors: [
        ...errors,
        'Nessuna proprietà Search Console corrisponde a ' +
          domain +
          '. Se il dominio appartiene a un altro dei tuoi account Google, collegalo con ' +
          '"npm run gsc:login" e rilancia l’audit.',
      ],
    });
  }

  // I dati di ricerca hanno ~2 giorni di ritardo: si chiudono 28 giorni a ritroso da lì.
  const end = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  const start = new Date(end.getTime() - 28 * 24 * 3600 * 1000);

  let topPages: SearchRow[] = [];
  let topQueries: SearchRow[] = [];
  try {
    [topPages, topQueries] = await Promise.all([
      querySearchAnalytics(property, 'page', isoDate(start), isoDate(end), 100),
      querySearchAnalytics(property, 'query', isoDate(start), isoDate(end), 25),
    ]);
  } catch (err) {
    errors.push('Search Analytics: ' + (err instanceof Error ? err.message : String(err)));
  }

  // ── Campione da ispezionare: pagine con click reali, poi le più linkate ──
  const seen = new Set<string>();
  const sample: string[] = [];
  for (const row of topPages) {
    const url = row.keys[0];
    if (url && !seen.has(url)) {
      seen.add(url);
      sample.push(url);
    }
    if (sample.length >= INSPECTION_SAMPLE) break;
  }
  for (const url of candidateUrls) {
    if (sample.length >= INSPECTION_SAMPLE) break;
    if (!seen.has(url)) {
      seen.add(url);
      sample.push(url);
    }
  }

  const inspections: InspectionResult[] = [];
  for (const url of sample) {
    try {
      inspections.push(await inspectUrl(property, url));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push('Ispezione ' + url + ': ' + message);
      // La quota giornaliera è condivisa: al primo 429 è inutile insistere.
      if (message.includes('429')) break;
    }
  }

  if (errors.length > 0) {
    logger.warn({ errors }, 'Search Console: raccolta parziale');
  }

  return {
    property: property.siteUrl,
    viaAccount: property.account.email,
    periodStart: isoDate(start),
    periodEnd: isoDate(end),
    totalClicks: topPages.reduce((sum, row) => sum + row.clicks, 0),
    totalImpressions: topPages.reduce((sum, row) => sum + row.impressions, 0),
    topPages,
    topQueries,
    inspections,
    links,
    availableProperties,
    errors,
  };
}
