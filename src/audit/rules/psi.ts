import { cwvLabel, formatMs } from '../../pagespeed';
import type { Rule } from '../types';

/**
 * Regole basate su PageSpeed Insights.
 *
 * Le regole sui tempi di risposta del crawler restano: misurano il server. Queste misurano
 * l'esperienza: il punteggio Lighthouse (laboratorio) e i Core Web Vitals degli utenti Chrome
 * reali (campo), che sono i numeri che Google usa davvero nel ranking.
 */
export const psiRules: Rule[] = [
  {
    id: 'psi-performance-low',
    title: 'Punteggio PageSpeed insufficiente',
    category: 'performance',
    severity: 'medium',
    effort: 'high',
    description:
      'Il punteggio prestazioni di Lighthouse (misurazione di laboratorio di Google sulla home) ' +
      'è sotto la soglia dei 90 punti considerata buona.',
    seoImpact:
      'Il punteggio riassume metriche che pesano sull’esperienza reale: quanto tarda il ' +
      'contenuto principale, quanto la pagina resta bloccata dal JavaScript, quanto salta il ' +
      'layout. Pagine lente convertono meno e, tramite i Core Web Vitals, perdono terreno in SERP.',
    recommendation:
      'Apri il report completo su pagespeed.web.dev: elenca gli interventi in ordine di guadagno ' +
      'stimato. I sospetti abituali: immagini non ottimizzate, JavaScript di terze parti, ' +
      'CSS bloccante, assenza di cache.',
    evaluate(ctx) {
      const mobile = ctx.pagespeed?.mobile?.lab;
      if (!mobile || mobile.performanceScore === null) return null;
      if (mobile.performanceScore >= 90) return null;

      const desktop = ctx.pagespeed?.desktop?.lab.performanceScore;
      return {
        urls: [
          {
            url: ctx.pagespeed?.testedUrl ?? ctx.crawl.rootUrl,
            evidence:
              'Mobile ' +
              mobile.performanceScore +
              '/100' +
              (desktop !== null && desktop !== undefined ? ' · desktop ' + desktop + '/100' : '') +
              ' · LCP ' +
              formatMs(mobile.lcpMs) +
              ' · TBT ' +
              formatMs(mobile.tbtMs),
          },
        ],
        scopeSize: 1,
        // Sotto i 50 Lighthouse stesso classifica la pagina come scarsa.
        severityOverride: mobile.performanceScore < 50 ? 'high' : undefined,
      };
    },
  },
  {
    id: 'psi-cwv-failing',
    title: 'Core Web Vitals reali non superati',
    category: 'performance',
    severity: 'high',
    effort: 'high',
    description:
      'I Core Web Vitals misurati sugli utenti Chrome reali negli ultimi 28 giorni ' +
      '(Chrome UX Report) non raggiungono le soglie di Google.',
    seoImpact:
      'A differenza del punteggio di laboratorio, questi sono esattamente i dati che Google ' +
      'usa come segnale di ranking: un verdetto negativo pesa su tutte le query, e pesa di più ' +
      'dove la concorrenza li supera.',
    recommendation:
      'Concentrati sulla metrica peggiore: LCP oltre 2,5 s indica risorse pesanti o server ' +
      'lento; INP oltre 200 ms indica JavaScript che blocca le interazioni; CLS oltre 0,1 ' +
      'indica elementi senza dimensioni riservate. Verifica i progressi in Search Console.',
    evaluate(ctx) {
      const field = ctx.pagespeed?.mobile?.field;
      if (!field || field.overall === null || field.overall === 'FAST') return null;

      return {
        urls: [
          {
            url: ctx.pagespeed?.testedUrl ?? ctx.crawl.rootUrl,
            evidence:
              'Verdetto: ' +
              cwvLabel(field.overall) +
              ' · LCP ' +
              formatMs(field.lcpMs) +
              ' · INP ' +
              formatMs(field.inpMs) +
              ' · CLS ' +
              (field.cls === null ? '—' : field.cls.toFixed(2)) +
              (field.originFallback ? ' (dati dell’intero dominio)' : ''),
          },
        ],
        scopeSize: 1,
        severityOverride: field.overall === 'SLOW' ? 'high' : 'medium',
      };
    },
  },
];
