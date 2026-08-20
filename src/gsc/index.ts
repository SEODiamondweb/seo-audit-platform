import { env } from '../config/env';
import { logger } from '../utils/logger';
import { loadServiceAccount } from './auth';
import { inspectUrl, querySearchAnalytics, resolveProperty } from './client';
import { loadGscLinks } from './links';
import type { InspectionResult, SearchRow } from './client';
import type { GscLinksReport } from './links';

export type { InspectionResult, SearchRow } from './client';
export type { GscLinksReport, LinkingSite, LinkedPage } from './links';

/** Quante pagine ispezionare con la URL Inspection API (limite Google: 2000/giorno). */
const INSPECTION_SAMPLE = 15;

export interface GscReport {
  property: string;
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
  /** Proprietà a cui il service account ha accesso: mostrate quando il dominio non corrisponde. */
  availableProperties: string[];
  errors: string[];
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Raccoglie i dati Search Console per il dominio.
 *
 * Ritorna null se il service account non è configurato o non ha accesso a una proprietà
 * del dominio: in quel caso il report spiega come attivare l'integrazione. Gli errori
 * parziali (es. quota della URL Inspection esaurita) non fanno fallire il resto.
 *
 * Le pagine da ispezionare vengono scelte fra le più importanti: prima quelle con più
 * click reali, poi le più linkate internamente.
 */
export async function collectGscData(
  domain: string,
  candidateUrls: string[],
): Promise<GscReport | null> {
  const account = await loadServiceAccount();
  const links = await loadGscLinks(domain);

  if (!account) {
    // Senza API, gli export manuali dei link valgono comunque un report parziale.
    if (!links) return null;
    return {
      property: '',
      periodStart: '',
      periodEnd: '',
      totalClicks: 0,
      totalImpressions: 0,
      topPages: [],
      topQueries: [],
      inspections: [],
      links,
      availableProperties: [],
      errors: ['Service account non configurato: disponibili solo gli export del report Link.'],
    };
  }

  const errors: string[] = [];

  let property: string | null = null;
  let availableProperties: string[] = [];
  try {
    const lookup = await resolveProperty(domain);
    property = lookup.property;
    availableProperties = lookup.available;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  if (!property) {
    // Comunicare il mancato match è un requisito, non un caso d’errore da nascondere:
    // il report deve dire "collegato ma questa proprietà manca", mai tacere o inventare.
    return {
      property: '',
      periodStart: '',
      periodEnd: '',
      totalClicks: 0,
      totalImpressions: 0,
      topPages: [],
      topQueries: [],
      inspections: [],
      links,
      availableProperties,
      errors: [
        ...errors,
        'Nessuna proprietà Search Console corrisponde a ' +
          domain +
          ': aggiungi l’email del service account come utente (Proprietario richiesto per farlo) nella proprietà di questo dominio.',
      ],
    };
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

  const totalClicks = topPages.reduce((sum, row) => sum + row.clicks, 0);
  const totalImpressions = topPages.reduce((sum, row) => sum + row.impressions, 0);

  if (errors.length > 0) {
    logger.warn({ errors }, 'Search Console: raccolta parziale');
  }

  return {
    property,
    periodStart: isoDate(start),
    periodEnd: isoDate(end),
    totalClicks,
    totalImpressions,
    topPages,
    topQueries,
    inspections,
    links,
    availableProperties,
    errors,
  };
}

export function gscIsConfigured(): boolean {
  return env.GSC_CREDENTIALS_PATH !== '';
}
