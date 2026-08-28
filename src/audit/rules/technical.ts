import { truncate } from '../../utils/text';
import type { IssueUrl, Rule } from '../types';

const SLOW_MS = 1500;
const VERY_SLOW_MS = 3000;
const HEAVY_BYTES = 2 * 1024 * 1024;

export const technicalRules: Rule[] = [
  // ── Performance ────────────────────────────────────────────────────────────
  {
    id: 'very-slow-pages',
    title: 'Pagine con tempo di risposta molto alto',
    category: 'performance',
    severity: 'high',
    effort: 'high',
    description:
      'Pagine che impiegano più di ' + VERY_SLOW_MS + ' ms a restituire la risposta completa al crawler.',
    seoImpact:
      'Un tempo di risposta elevato peggiora direttamente LCP e INP, riduce il tasso di conversione e induce Google a ridurre la frequenza di scansione del sito.',
    recommendation:
      'Attiva una cache a pagina intera, ottimizza le query lente, abilita compressione e HTTP/2 o HTTP/3 e valuta una CDN. Misura poi i risultati reali con PageSpeed Insights e i dati CrUX.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.pages
        .filter((p) => p.responseTimeMs > VERY_SLOW_MS && p.statusCode > 0)
        .map((p) => ({ url: p.url, evidence: p.responseTimeMs + ' ms' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'slow-pages',
    title: 'Pagine lente',
    category: 'performance',
    severity: 'medium',
    effort: 'medium',
    description:
      'Pagine con tempo di risposta compreso fra ' + SLOW_MS + ' e ' + VERY_SLOW_MS + ' ms.',
    seoImpact:
      'Tempi in questa fascia mettono a rischio la soglia dei Core Web Vitals, soprattutto su rete mobile e dispositivi di fascia media.',
    recommendation:
      'Riduci il TTFB con caching lato server e ottimizzazione del database; rimanda o elimina gli script di terze parti non essenziali.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.pages
        .filter((p) => p.responseTimeMs > SLOW_MS && p.responseTimeMs <= VERY_SLOW_MS)
        .map((p) => ({ url: p.url, evidence: p.responseTimeMs + ' ms' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'heavy-pages',
    title: 'Pagine HTML molto pesanti',
    category: 'performance',
    severity: 'medium',
    effort: 'medium',
    description:
      'Pagine il cui solo documento HTML supera i ' + Math.round(HEAVY_BYTES / 1024 / 1024) + ' MB.',
    seoImpact:
      'Un HTML molto pesante ritarda il parsing e il first paint, e su siti grandi può portare Google a troncare l’analisi del documento.',
    recommendation:
      'Riduci il markup inline (CSS e JS incorporati, dati base64, contenuti nascosti generati dal page builder) e pagina gli elenchi molto lunghi.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.htmlPages
        .filter((p) => p.sizeBytes > HEAVY_BYTES)
        .map((p) => ({ url: p.url, evidence: (p.sizeBytes / 1024 / 1024).toFixed(2) + ' MB di HTML' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'missing-viewport',
    title: 'Pagine senza meta viewport',
    category: 'performance',
    severity: 'high',
    effort: 'low',
    description: 'Pagine HTML prive del meta tag viewport.',
    seoImpact:
      'La pagina non è mobile friendly: con l’indicizzazione mobile-first questo penalizza direttamente il posizionamento su tutti i dispositivi.',
    recommendation:
      'Aggiungi <meta name="viewport" content="width=device-width, initial-scale=1"> in tutti i template.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.htmlPages
        .filter((p) => p.statusCode >= 200 && p.statusCode < 300 && !p.hasViewport)
        .map((p) => ({ url: p.url, evidence: 'Meta viewport assente' }));
      return urls.length > 0 ? { urls } : null;
    },
  },

  // ── Sicurezza ──────────────────────────────────────────────────────────────
  {
    id: 'http-pages',
    title: 'Pagine servite in HTTP',
    category: 'security',
    severity: 'critical',
    effort: 'medium',
    description: 'URL raggiungibili tramite protocollo HTTP non cifrato.',
    seoImpact:
      'HTTPS è un fattore di ranking dichiarato; i browser marcano le pagine HTTP come non sicure, con impatto diretto su fiducia e conversioni. La coesistenza delle due versioni genera inoltre duplicazione.',
    recommendation:
      'Forza il redirect 301 di tutto il traffico HTTP verso HTTPS a livello di server, aggiorna i link interni assoluti e abilita HSTS.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.pages
        .filter((p) => !p.https)
        .map((p) => ({ url: p.url, evidence: 'Protocollo HTTP' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'mixed-content',
    title: 'Contenuto misto su pagine HTTPS',
    category: 'security',
    severity: 'high',
    effort: 'medium',
    description:
      'Pagine HTTPS che caricano risorse (immagini, script, CSS, iframe) tramite HTTP.',
    seoImpact:
      'I browser bloccano gli script e i fogli di stile non sicuri e mostrano avvisi: la pagina può risultare rotta e perde il segnale di connessione sicura.',
    recommendation:
      'Aggiorna tutte le risorse a https:// o a URL relative al protocollo. Nei database WordPress sostituisci le occorrenze residue di http:// con una search & replace controllata.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.htmlPages
        .filter((p) => p.mixedContent.length > 0)
        .map((p) => ({
          url: p.url,
          evidence:
            p.mixedContent.length + ' risorse HTTP (es. ' + truncate(p.mixedContent[0] ?? '', 70) + ')',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'missing-hsts',
    title: 'Header HSTS assente',
    category: 'security',
    severity: 'low',
    effort: 'low',
    description:
      'Le risposte HTTPS non includono l header Strict-Transport-Security.',
    seoImpact:
      'Senza HSTS resta possibile un downgrade a HTTP sulla prima connessione. È un segnale di configurazione incompleta più che un fattore di ranking diretto.',
    recommendation:
      'Aggiungi Strict-Transport-Security: max-age=31536000; includeSubDomains dopo aver verificato che tutti i sottodomini siano raggiungibili in HTTPS.',
    evaluate(ctx) {
      const httpsPages = ctx.htmlPages.filter((p) => p.https && p.statusCode === 200);
      if (httpsPages.length === 0) return null;
      const missing = httpsPages.filter((p) => !p.securityHeaders['strict-transport-security']);
      if (missing.length < httpsPages.length) return null;
      return {
        urls: [{ url: ctx.crawl.rootUrl, evidence: 'Header assente su tutte le risposte HTTPS' }],
        scopeSize: 1,
      };
    },
  },
  {
    id: 'missing-security-headers',
    title: 'Header di sicurezza raccomandati assenti',
    category: 'security',
    severity: 'low',
    effort: 'low',
    description:
      'Mancano header come X-Content-Type-Options, X-Frame-Options, Referrer-Policy o Content-Security-Policy.',
    seoImpact:
      'Non incidono direttamente sul ranking, ma riducono il rischio di clickjacking, MIME sniffing e injection: incidenti che possono portare a segnalazioni di sicurezza in Search Console.',
    recommendation:
      'Configura a livello di web server: X-Content-Type-Options: nosniff, X-Frame-Options: SAMEORIGIN, Referrer-Policy: strict-origin-when-cross-origin e una Content-Security-Policy adeguata.',
    evaluate(ctx) {
      const sample = ctx.htmlPages.find((p) => p.statusCode === 200);
      if (!sample) return null;
      const expected = ['x-content-type-options', 'x-frame-options', 'referrer-policy'];
      const missing = expected.filter((h) => !sample.securityHeaders[h]);
      if (missing.length === 0) return null;
      return {
        urls: [{ url: sample.url, evidence: 'Header mancanti: ' + missing.join(', ') }],
        scopeSize: 1,
      };
    },
  },
];
