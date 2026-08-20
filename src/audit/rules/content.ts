import { truncate } from '../../utils/text';
import type { CrawledUrl } from '../../crawler/types';
import type { IssueUrl, Rule } from '../types';

const THIN_CONTENT_WORDS = 300;
const DEEP_PAGE_THRESHOLD = 3;
const MAX_OUTLINKS = 150;

const GENERIC_ANCHORS = new Set([
  'clicca qui',
  'clicca',
  'qui',
  'leggi di più',
  'leggi di più',
  'leggi tutto',
  'scopri di più',
  'scopri di più',
  'continua',
  'continua a leggere',
  'vai',
  'link',
  'questo link',
  'click here',
  'read more',
  'learn more',
  'here',
  'more',
]);

export const contentRules: Rule[] = [
  // ── Contenuti ──────────────────────────────────────────────────────────────
  {
    id: 'thin-content',
    title: 'Pagine con contenuto scarso (thin content)',
    category: 'content',
    severity: 'medium',
    effort: 'high',
    description:
      'Pagine indicizzabili con meno di ' + THIN_CONTENT_WORDS + ' parole di testo nel body.',
    seoImpact:
      'Le pagine con poco contenuto raramente soddisfano l’intento di ricerca e possono essere valutate come contenuto di bassa qualità, penalizzando la percezione complessiva del sito.',
    recommendation:
      'Espandi le pagine con contenuto realmente utile (specifiche, FAQ, casi d’uso, contenuti multimediali) oppure consolidale in pagine più ampie con un redirect 301, o escludile dall’indice se sono pagine di servizio.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => p.wordCount < THIN_CONTENT_WORDS)
        .map((p) => ({ url: p.url, evidence: p.wordCount + ' parole' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'duplicate-content',
    title: 'Contenuti duplicati fra pagine diverse',
    category: 'content',
    severity: 'high',
    effort: 'high',
    description:
      'Pagine indicizzabili distinte il cui testo del body risulta identico dopo la normalizzazione.',
    seoImpact:
      'Google seleziona una sola versione da indicizzare e ignora le altre: i segnali di ranking si disperdono e il crawl budget viene sprecato sulle copie.',
    recommendation:
      'Individua la versione autorevole e consolida le altre con canonical o redirect 301. Dove la duplicazione nasce da parametri di filtro o ordinamento, gestiscila con canonical autoreferenziale e regole di scansione.',
    evaluate(ctx) {
      const groups = new Map<string, CrawledUrl[]>();
      for (const page of ctx.indexablePages) {
        if (!page.contentHash || page.wordCount < 50) continue;
        const bucket = groups.get(page.contentHash);
        if (bucket) bucket.push(page);
        else groups.set(page.contentHash, [page]);
      }

      const urls: IssueUrl[] = [];
      for (const bucket of groups.values()) {
        if (bucket.length < 2) continue;
        for (const page of bucket) {
          urls.push({
            url: page.url,
            evidence:
              'Identica ad altre ' +
              (bucket.length - 1) +
              ' pagine (es. ' +
              truncate(bucket.find((p) => p.url !== page.url)?.url ?? '', 60) +
              ')',
          });
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'low-text-ratio',
    title: 'Rapporto testo/HTML molto basso',
    category: 'content',
    severity: 'low',
    effort: 'medium',
    description:
      'Pagine in cui il testo visibile rappresenta meno del 5% del codice HTML servito.',
    seoImpact:
      'Indica markup ridondante o contenuto caricato via JavaScript: aumenta il peso della pagina e riduce la densità informativa percepita dal crawler.',
    recommendation:
      'Riduci il markup superfluo (wrapper annidati, CSS e JS inline, builder verbosi) e assicurati che il contenuto principale sia presente nell’HTML servito, non solo dopo l’esecuzione del JavaScript.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => p.sizeBytes > 10000 && p.textRatio > 0 && p.textRatio < 0.05)
        .map((p) => ({
          url: p.url,
          evidence: (p.textRatio * 100).toFixed(1) + '% di testo su ' + Math.round(p.sizeBytes / 1024) + ' KB',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'missing-lang-attribute',
    title: 'Attributo lang assente sul tag html',
    category: 'content',
    severity: 'low',
    effort: 'low',
    description: 'Pagine indicizzabili il cui tag <html> non dichiara l’attributo lang.',
    seoImpact:
      'La lingua della pagina non è dichiarata esplicitamente: impatta accessibilità, traduzione automatica e coerenza delle annotazioni hreflang.',
    recommendation:
      'Imposta lang sul tag html in tutti i template (es. <html lang="it">), allineandolo alla lingua effettiva del contenuto.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => !p.lang)
        .map((p) => ({ url: p.url, evidence: 'Attributo lang assente' }));
      return urls.length > 0 ? { urls } : null;
    },
  },

  // ── Linking interno ────────────────────────────────────────────────────────
  {
    id: 'deep-pages',
    title: 'Pagine troppo profonde nella struttura',
    category: 'internal_linking',
    severity: 'medium',
    effort: 'medium',
    description:
      'Pagine indicizzabili raggiungibili solo con più di ' +
      DEEP_PAGE_THRESHOLD +
      ' click dalla home page.',
    seoImpact:
      'La profondità di click è un proxy dell’importanza percepita: le pagine profonde ricevono meno autorevolezza interna e vengono scansionate con minore frequenza.',
    recommendation:
      'Accorcia i percorsi con hub tematici, link contestuali dalle pagine di alto livello, breadcrumb e blocchi di contenuti correlati. Rivedi la paginazione degli archivi molto lunghi.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => p.depth > DEEP_PAGE_THRESHOLD)
        .map((p) => ({ url: p.url, evidence: 'Profondità ' + p.depth + ' click' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'low-inlinks',
    title: 'Pagine con pochissimi link interni in entrata',
    category: 'internal_linking',
    severity: 'medium',
    effort: 'medium',
    description:
      'Pagine indicizzabili con al massimo un link interno in entrata proveniente da una sola pagina.',
    seoImpact:
      'Ricevono pochissima autorevolezza interna: sono percepite come marginali e faticano a posizionarsi anche con contenuti validi.',
    recommendation:
      'Aggiungi link interni contestuali dalle pagine correlate più forti, usando anchor text descrittivi e pertinenti alla query target della pagina di destinazione.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => p.uniqueInlinks <= 1 && p.depth > 0)
        .map((p) => ({ url: p.url, evidence: p.uniqueInlinks + ' pagine la linkano' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'too-many-outlinks',
    title: 'Pagine con un numero eccessivo di link',
    category: 'internal_linking',
    severity: 'low',
    effort: 'medium',
    description: 'Pagine che contengono più di ' + MAX_OUTLINKS + ' link in uscita.',
    seoImpact:
      'Un numero elevato di link diluisce l’autorevolezza trasmessa a ciascuna destinazione e rende meno leggibile la struttura del sito al crawler.',
    recommendation:
      'Riduci i link nei mega menu e nei footer, sostituendo gli elenchi esaustivi con hub intermedi. Mantieni nel corpo pagina solo i link realmente utili all’utente.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.htmlPages
        .filter((p) => p.outlinks > MAX_OUTLINKS)
        .map((p) => ({
          url: p.url,
          evidence: p.outlinks + ' link (' + p.externalOutlinks + ' esterni)',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'nofollow-internal-links',
    title: 'Link interni con rel="nofollow"',
    category: 'internal_linking',
    severity: 'low',
    effort: 'low',
    description: 'Pagine che contengono link interni marcati come nofollow.',
    seoImpact:
      'Il nofollow interno non preserva l’autorevolezza: la disperde e basta. Non è più un metodo valido per il PageRank sculpting.',
    recommendation:
      'Rimuovi il nofollow dai link interni. Per escludere una destinazione dall’indice usa noindex sulla pagina di destinazione, non il nofollow sul link.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.htmlPages
        .filter((p) => p.internalLinks.some((l) => l.nofollow))
        .map((p) => ({
          url: p.url,
          evidence: p.internalLinks.filter((l) => l.nofollow).length + ' link interni nofollow',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'generic-anchor-text',
    title: 'Anchor text generici sui link interni',
    category: 'internal_linking',
    severity: 'low',
    effort: 'low',
    description:
      'Link interni con anchor text privi di significato semantico ("clicca qui", "leggi di più", "qui").',
    seoImpact:
      'L’anchor text è uno dei segnali con cui Google interpreta il contenuto della pagina di destinazione: un anchor generico non trasmette alcuna informazione.',
    recommendation:
      'Sostituisci gli anchor generici con testi descrittivi che anticipino il contenuto della destinazione, evitando pero la ripetizione meccanica della stessa keyword.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.htmlPages) {
        const generic = page.internalLinks.filter((l) =>
          GENERIC_ANCHORS.has(l.anchor.trim().toLowerCase()),
        );
        if (generic.length > 0) {
          urls.push({
            url: page.url,
            evidence:
              generic.length +
              ' anchor generici: ' +
              truncate([...new Set(generic.map((l) => l.anchor))].join(', '), 80),
          });
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
];
