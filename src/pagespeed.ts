import { env } from './config/env';
import { logger } from './utils/logger';

/**
 * Integrazione con PageSpeed Insights (API v5).
 *
 * È la fonte scelta per la velocità del sito: il tempo di risposta misurato dal crawler dice
 * quanto è lento il server, ma non come la pagina viene vissuta da un utente. PSI fornisce
 * entrambe le prospettive:
 *
 *  - dati di laboratorio (Lighthouse): una misurazione controllata eseguita da Google al
 *    momento della richiesta — punteggio 0-100 e metriche simulate;
 *  - dati sul campo (Chrome UX Report): i Core Web Vitals degli utenti Chrome reali negli
 *    ultimi 28 giorni. Sono i numeri che Google usa per il ranking, ma esistono solo se il
 *    sito ha traffico sufficiente.
 *
 * L'API funziona anche senza chiave per volumi bassi; con PAGESPEED_API_KEY si evita il
 * rate limiting condiviso. Ogni misurazione richiede 15-40 secondi lato Google.
 */

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export type PsiStrategy = 'mobile' | 'desktop';
export type CwvCategory = 'FAST' | 'AVERAGE' | 'SLOW';

export interface PsiLabMetrics {
  /** Punteggio prestazioni Lighthouse, 0-100. */
  performanceScore: number | null;
  fcpMs: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  speedIndexMs: number | null;
}

export interface PsiFieldData {
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  /** Verdetto complessivo di Google sui Core Web Vitals reali. */
  overall: CwvCategory | null;
  /** true se i dati sono dell'intera origine, non della singola pagina (poco traffico). */
  originFallback: boolean;
}

export interface PsiStrategyResult {
  strategy: PsiStrategy;
  lab: PsiLabMetrics;
  /** Null quando il CrUX non ha abbastanza traffico per questa pagina/origine. */
  field: PsiFieldData | null;
}

export interface PageSpeedResult {
  testedUrl: string;
  fetchedAt: string;
  mobile: PsiStrategyResult | null;
  desktop: PsiStrategyResult | null;
  errors: string[];
}

type Json = Record<string, unknown>;

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Estrae le metriche da una risposta PSI. Esportata per essere testabile su fixture. */
export function parsePsiResponse(json: Json, strategy: PsiStrategy): PsiStrategyResult {
  const lighthouse = json['lighthouseResult'] as Json | undefined;
  const categories = lighthouse?.['categories'] as Json | undefined;
  const performance = categories?.['performance'] as Json | undefined;
  const audits = (lighthouse?.['audits'] as Record<string, Json> | undefined) ?? {};

  const audit = (id: string): number | null => num(audits[id]?.['numericValue']);
  const rawScore = num(performance?.['score']);

  const lab: PsiLabMetrics = {
    performanceScore: rawScore === null ? null : Math.round(rawScore * 100),
    fcpMs: audit('first-contentful-paint'),
    lcpMs: audit('largest-contentful-paint'),
    tbtMs: audit('total-blocking-time'),
    cls: audit('cumulative-layout-shift'),
    speedIndexMs: audit('speed-index'),
  };

  const experience = json['loadingExperience'] as Json | undefined;
  const metrics = experience?.['metrics'] as Record<string, Json> | undefined;

  let field: PsiFieldData | null = null;
  if (metrics && Object.keys(metrics).length > 0) {
    const percentile = (key: string): number | null => num(metrics[key]?.['percentile']);
    const rawCls = percentile('CUMULATIVE_LAYOUT_SHIFT_SCORE');
    const overall = experience?.['overall_category'];
    field = {
      lcpMs: percentile('LARGEST_CONTENTFUL_PAINT_MS'),
      inpMs: percentile('INTERACTION_TO_NEXT_PAINT'),
      // Il CLS arriva moltiplicato per 100 per poter essere un percentile intero.
      cls: rawCls === null ? null : rawCls / 100,
      overall:
        overall === 'FAST' || overall === 'AVERAGE' || overall === 'SLOW' ? overall : null,
      originFallback: experience?.['origin_fallback'] === true,
    };
  }

  return { strategy, lab, field };
}

async function fetchStrategy(url: string, strategy: PsiStrategy): Promise<PsiStrategyResult> {
  const params = new URLSearchParams({
    url,
    strategy,
    category: 'performance',
    locale: 'it',
  });
  if (env.PAGESPEED_API_KEY) params.set('key', env.PAGESPEED_API_KEY);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.PAGESPEED_TIMEOUT_MS);

  try {
    const response = await fetch(PSI_ENDPOINT + '?' + params.toString(), {
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        'PSI ' + strategy + ': HTTP ' + response.status + ' ' + body.slice(0, 200),
      );
    }
    const json = (await response.json()) as Json;
    return parsePsiResponse(json, strategy);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Misura la URL indicata (di norma la home) su mobile e desktop.
 * Ritorna null se l'integrazione è disattivata; non lancia mai — un fallimento di PSI
 * non deve far fallire l'audit, che resta valido su tutto il resto.
 */
export async function runPageSpeed(url: string): Promise<PageSpeedResult | null> {
  if (!env.PAGESPEED_ENABLED) return null;

  const result: PageSpeedResult = {
    testedUrl: url,
    fetchedAt: new Date().toISOString(),
    mobile: null,
    desktop: null,
    errors: [],
  };

  // In parallelo: sono 15-40 secondi l'una, in serie raddoppierebbero l'attesa.
  const [mobile, desktop] = await Promise.allSettled([
    fetchStrategy(url, 'mobile'),
    fetchStrategy(url, 'desktop'),
  ]);

  if (mobile.status === 'fulfilled') result.mobile = mobile.value;
  else result.errors.push(mobile.reason instanceof Error ? mobile.reason.message : String(mobile.reason));

  if (desktop.status === 'fulfilled') result.desktop = desktop.value;
  else result.errors.push(desktop.reason instanceof Error ? desktop.reason.message : String(desktop.reason));

  if (result.errors.length > 0) {
    logger.warn({ errors: result.errors }, 'PageSpeed Insights parzialmente fallito');
  }
  if (!result.mobile && !result.desktop) return result; // solo errori: il report lo segnala

  return result;
}

export function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  return ms >= 1000 ? (ms / 1000).toFixed(1).replace('.', ',') + ' s' : Math.round(ms) + ' ms';
}

export function cwvLabel(category: CwvCategory | null): string {
  switch (category) {
    case 'FAST':
      return 'Buoni';
    case 'AVERAGE':
      return 'Da migliorare';
    case 'SLOW':
      return 'Scarsi';
    default:
      return '—';
  }
}
