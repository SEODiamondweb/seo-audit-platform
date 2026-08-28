import { truncate } from '../../utils/text';
import type { IssueUrl, Rule } from '../types';

export const mediaRules: Rule[] = [
  // ── Immagini ───────────────────────────────────────────────────────────────
  {
    id: 'images-missing-alt',
    title: 'Immagini senza attributo alt',
    category: 'images',
    severity: 'medium',
    effort: 'medium',
    description:
      'Pagine che contengono immagini prive dell’attributo alt (attributo assente, non alt vuoto).',
    seoImpact:
      'Il testo alternativo è il principale segnale per Google Immagini e per l’accessibilità: senza alt le immagini non si posizionano e gli utenti con screen reader perdono l’informazione.',
    recommendation:
      'Aggiungi un alt descrittivo e specifico a ogni immagine di contenuto. Usa alt="" (vuoto ma presente) solo per le immagini puramente decorative.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.htmlPages
        .filter((p) => p.imagesMissingAlt > 0)
        .map((p) => {
          const examples = p.images
            .filter((img) => !img.hasAltAttribute)
            .slice(0, 2)
            .map((img) => img.src.split('/').pop() ?? img.src);
          return {
            url: p.url,
            evidence:
              p.imagesMissingAlt +
              ' immagini su ' +
              p.images.length +
              (examples.length > 0 ? ' (es. ' + truncate(examples.join(', '), 60) + ')' : ''),
          };
        });
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'images-missing-dimensions',
    title: 'Immagini senza attributi width e height',
    category: 'images',
    severity: 'low',
    effort: 'low',
    description:
      'Pagine con immagini che non dichiarano width e height nell’HTML.',
    seoImpact:
      'Senza dimensioni esplicite il browser non può riservare lo spazio prima del caricamento: si generano spostamenti di layout che peggiorano il Cumulative Layout Shift, uno dei Core Web Vitals.',
    recommendation:
      'Dichiara width e height (o un aspect-ratio via CSS) su tutte le immagini, lasciando che il CSS gestisca il ridimensionamento responsive.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.htmlPages) {
        const missing = page.images.filter((img) => !img.width || !img.height);
        if (missing.length > 0) {
          urls.push({
            url: page.url,
            evidence: missing.length + ' immagini su ' + page.images.length + ' senza dimensioni',
          });
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'images-no-lazy-loading',
    title: 'Pagine con molte immagini senza lazy loading',
    category: 'images',
    severity: 'low',
    effort: 'low',
    description:
      'Pagine con più di 10 immagini in cui la maggior parte non usa loading="lazy".',
    seoImpact:
      'Il caricamento immediato di tutte le immagini rallenta il Largest Contentful Paint e consuma banda inutilmente sui dispositivi mobili.',
    recommendation:
      'Applica loading="lazy" a tutte le immagini sotto la piega, mantenendo il caricamento immediato (eventualmente con fetchpriority="high") solo per l’immagine hero.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.htmlPages) {
        if (page.images.length <= 10) continue;
        const lazy = page.images.filter((img) => img.loading === 'lazy').length;
        if (lazy / page.images.length < 0.5) {
          urls.push({
            url: page.url,
            evidence: lazy + ' immagini lazy su ' + page.images.length,
          });
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },

  // ── Dati strutturati ───────────────────────────────────────────────────────
  {
    id: 'invalid-structured-data',
    title: 'Dati strutturati non validi',
    category: 'structured_data',
    severity: 'high',
    effort: 'medium',
    description:
      'Blocchi JSON-LD non parsabili oppure privi di @context, @type o delle proprietà obbligatorie del tipo dichiarato.',
    seoImpact:
      'Il markup non valido viene scartato: la pagina perde l’eleggibilità ai rich result (stelle, FAQ, breadcrumb, prezzi) e la relativa visibilità in SERP.',
    recommendation:
      'Correggi i blocchi segnalati e verificali con il Rich Results Test di Google e con lo Schema Markup Validator prima della messa online.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.htmlPages
        .filter((p) => p.structuredDataErrors.length > 0)
        .map((p) => ({
          url: p.url,
          evidence: truncate(p.structuredDataErrors.join(' | '), 140),
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'missing-structured-data',
    title: 'Pagine senza dati strutturati',
    category: 'structured_data',
    severity: 'low',
    effort: 'medium',
    description: 'Pagine indicizzabili che non contengono alcun markup strutturato.',
    seoImpact:
      'Senza Schema.org la pagina non può ottenere rich result e Google ha meno elementi espliciti per interpretare entità, relazioni e tipo di contenuto.',
    recommendation:
      'Implementa il markup adatto al tipo di pagina (Article, Product, LocalBusiness, FAQPage, BreadcrumbList) con JSON-LD, collegando le entità fra loro tramite @id.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => p.structuredData.length === 0)
        .map((p) => ({ url: p.url, evidence: 'Nessun blocco JSON-LD, microdata o RDFa' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'missing-breadcrumb-schema',
    title: 'Assenza di markup BreadcrumbList',
    category: 'structured_data',
    severity: 'low',
    effort: 'low',
    description:
      'Nessuna delle pagine interne analizzate dichiara un markup BreadcrumbList.',
    seoImpact:
      'Google mostra il percorso di navigazione al posto della URL nei risultati: senza questo markup lo snippet risulta meno leggibile e perde contesto gerarchico.',
    recommendation:
      'Aggiungi il markup BreadcrumbList in JSON-LD su tutte le pagine interne, coerente con il breadcrumb visibile nella pagina.',
    evaluate(ctx) {
      const innerPages = ctx.indexablePages.filter((p) => p.depth > 0);
      if (innerPages.length < 5) return null;
      const withBreadcrumb = innerPages.filter((p) =>
        p.structuredDataTypes.some((t) => t.toLowerCase() === 'breadcrumblist'),
      );
      if (withBreadcrumb.length > 0) return null;
      return {
        urls: innerPages
          .slice(0, 50)
          .map((p) => ({ url: p.url, evidence: 'Nessun BreadcrumbList dichiarato' })),
        note: 'Nessuna delle ' + innerPages.length + ' pagine interne analizzate usa BreadcrumbList.',
      };
    },
  },
];
