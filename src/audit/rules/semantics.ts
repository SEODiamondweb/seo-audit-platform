import { truncate } from '../../utils/text';
import { readabilityLabel, stemTokens, tokenize } from '../../content';
import type { CrawledUrl } from '../../crawler/types';
import type { IssueUrl, Rule } from '../types';

/** Sotto questa soglia il testo è troppo breve perché l'analisi semantica sia attendibile. */
const MIN_WORDS_FOR_ANALYSIS = 200;
/** La keyword principale deve ricorrere almeno così tante volte per essere considerata tale. */
const MIN_KEYWORD_COUNT = 3;
const MAX_DENSITY = 0.04;
const MIN_GULPEASE = 40;
const MAX_SENTENCE_WORDS = 28;

const LISTING_PATTERNS = [
  /\/category\//i,
  /\/categoria\//i,
  /\/tag\//i,
  /\/author\//i,
  /\/autore\//i,
  /\/archiv/i,
  /\/page\/\d+/i,
  /\/pagina\/\d+/i,
  /[?&]s=/i,
  /\/search\//i,
  /\/ricerca\//i,
];

/**
 * Riconosce le pagine di elenco: archivi di categoria, tag, autore, paginazioni, ricerche.
 *
 * Sono aggregazioni di estratti altrui: non hanno un argomento proprio, e pretendere che la
 * keyword più ricorrente compaia nel loro title produce solo rumore. Vanno escluse dai
 * controlli di coerenza semantica, non dagli altri.
 */
export function isListingPage(page: CrawledUrl): boolean {
  if (LISTING_PATTERNS.some((pattern) => pattern.test(page.url))) return true;
  // Molti link e poco testo proprio: il profilo tipico di un elenco anche senza URL parlante.
  const words = page.content?.readability.words ?? page.wordCount;
  return page.internalLinks.length > 40 && words < 400;
}

/** Pagine indicizzabili con testo sufficiente e una keyword principale affidabile. */
function analyzablePages(pages: CrawledUrl[]): CrawledUrl[] {
  return pages.filter((page) => {
    const content = page.content;
    if (!content || !content.primaryKeyword) return false;
    if (isListingPage(page)) return false;
    if (content.readability.words < MIN_WORDS_FOR_ANALYSIS) return false;
    const primary = content.keywords[0];
    return primary !== undefined && primary.count >= MIN_KEYWORD_COUNT;
  });
}

export const semanticRules: Rule[] = [
  // ── Keyword e coerenza on-page ─────────────────────────────────────────────
  {
    id: 'keyword-not-in-title',
    title: 'Argomento della pagina assente dal title',
    category: 'content',
    severity: 'medium',
    effort: 'low',
    description:
      'La locuzione più ricorrente nel testo non compare nel tag title. Il title parla quindi ' +
      'di qualcosa di diverso rispetto a ciò di cui la pagina tratta davvero.',
    seoImpact:
      'Il title è il segnale di pertinenza più forte della pagina. Se non contiene l’argomento ' +
      'del contenuto, Google fatica ad associare la pagina alle query pertinenti e la posiziona ' +
      'su termini secondari o non la posiziona affatto.',
    recommendation:
      'Riscrivi il title mettendo in apertura la keyword principale del contenuto. Se invece è ' +
      'il testo a essere fuori fuoco rispetto al title, il problema è il contenuto: riscrivi quello.',
    evaluate(ctx) {
      const urls: IssueUrl[] = analyzablePages(ctx.indexablePages)
        .filter((p) => p.content?.placement?.inTitle === false)
        .map((p) => ({
          url: p.url,
          evidence:
            'Argomento: "' +
            truncate(p.content?.primaryKeyword ?? '', 40) +
            '" — title: "' +
            truncate(p.title ?? '', 55) +
            '"',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'keyword-not-in-h1',
    title: 'Argomento della pagina assente dall’H1',
    category: 'content',
    severity: 'medium',
    effort: 'low',
    description:
      'La locuzione più ricorrente nel testo non compare nell’H1 della pagina.',
    seoImpact:
      'H1 e contenuto disallineati indeboliscono il segnale tematico: Google usa l’H1 per ' +
      'capire di cosa tratta la pagina prima ancora di analizzare il corpo del testo.',
    recommendation:
      'Allinea l’H1 all’argomento reale del contenuto, mantenendolo diverso dal title nella forma ' +
      'ma coerente nel tema.',
    evaluate(ctx) {
      const urls: IssueUrl[] = analyzablePages(ctx.indexablePages)
        .filter((p) => p.content?.placement?.inH1 === false && p.h1.length > 0)
        .map((p) => ({
          url: p.url,
          evidence:
            'Argomento: "' +
            truncate(p.content?.primaryKeyword ?? '', 40) +
            '" — H1: "' +
            truncate(p.h1[0] ?? '', 55) +
            '"',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'title-h1-mismatch',
    title: 'Title e H1 parlano di argomenti diversi',
    category: 'content',
    severity: 'medium',
    effort: 'low',
    description:
      'Title e H1 non condividono nessuna parola significativa: non è una riformulazione, sono ' +
      'due messaggi distinti.',
    seoImpact:
      'Il visitatore che arriva dalla SERP legge un titolo e ne trova un altro in pagina: ' +
      'l’aspettativa è tradita, il tasso di rimbalzo sale e il segnale di pertinenza si indebolisce.',
    recommendation:
      'Riscrivi title e H1 attorno allo stesso concetto centrale, variando la forma ma non il tema. ' +
      'Il title può aggiungere il brand o un modificatore commerciale, l’H1 resta più descrittivo.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => {
          const content = p.content;
          if (!content || isListingPage(p)) return false;
          if (content.readability.words < MIN_WORDS_FOR_ANALYSIS) return false;
          return p.title !== null && p.h1.length > 0 && content.titleH1Overlap === 0;
        })
        .map((p) => ({
          url: p.url,
          evidence:
            'Title: "' + truncate(p.title ?? '', 45) + '" — H1: "' + truncate(p.h1[0] ?? '', 45) + '"',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'keyword-not-in-url',
    title: 'Argomento della pagina assente dallo slug',
    category: 'content',
    severity: 'low',
    effort: 'high',
    description:
      'La keyword principale del contenuto non compare nel percorso della URL.',
    seoImpact:
      'Lo slug è un segnale di pertinenza minore ma reale, ed è ciò che l’utente legge quando ' +
      'la URL viene condivisa o mostrata nel breadcrumb della SERP.',
    recommendation:
      'Valuta lo slug solo per i contenuti nuovi: cambiarlo su pagine già indicizzate richiede un ' +
      'redirect 301 e comporta una perdita temporanea di posizionamento, spesso non giustificata.',
    evaluate(ctx) {
      const urls: IssueUrl[] = analyzablePages(ctx.indexablePages)
        .filter((p) => p.content?.placement?.inUrl === false && p.depth > 0)
        .map((p) => ({
          url: p.url,
          evidence: 'Argomento: "' + truncate(p.content?.primaryKeyword ?? '', 50) + '"',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'keyword-stuffing',
    title: 'Sovra-ottimizzazione della keyword',
    category: 'content',
    severity: 'medium',
    effort: 'medium',
    description:
      'La keyword principale supera il ' +
      Math.round(MAX_DENSITY * 100) +
      '% delle parole della pagina: una ripetizione innaturale per un testo scritto per le persone.',
    seoImpact:
      'Il keyword stuffing è una violazione esplicita delle linee guida antispam di Google. ' +
      'Nel migliore dei casi il testo risulta sgradevole e allontana l’utente; nel peggiore la ' +
      'pagina viene declassata.',
    recommendation:
      'Riscrivi il testo usando sinonimi, varianti e termini correlati al posto della ripetizione ' +
      'letterale. La pertinenza si costruisce col campo semantico, non con la frequenza.',
    evaluate(ctx) {
      const urls: IssueUrl[] = analyzablePages(ctx.indexablePages)
        .filter((p) => (p.content?.primaryDensity ?? 0) > MAX_DENSITY)
        .map((p) => ({
          url: p.url,
          evidence:
            '"' +
            truncate(p.content?.primaryKeyword ?? '', 35) +
            '" al ' +
            ((p.content?.primaryDensity ?? 0) * 100).toFixed(1) +
            '% (' +
            (p.content?.keywords[0]?.count ?? 0) +
            ' occorrenze)',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'keyword-cannibalization',
    title: 'Pagine che competono sulla stessa keyword',
    category: 'content',
    severity: 'high',
    effort: 'high',
    description:
      'Più pagine indicizzabili del sito hanno la stessa locuzione come argomento principale.',
    seoImpact:
      'Google deve scegliere quale pagina mostrare e spesso ne alterna diverse, nessuna delle ' +
      'quali accumula abbastanza segnali per posizionarsi bene. I link interni ed esterni si ' +
      'dividono fra le versioni invece di sommarsi su una sola.',
    recommendation:
      'Per ogni gruppo scegli la pagina di riferimento e differenzia le altre su un intento di ' +
      'ricerca distinto, oppure consolidale in un unico contenuto più completo con redirect 301 ' +
      'dalle pagine assorbite.',
    evaluate(ctx) {
      // La chiave e la forma ridotta, ma nel report va mostrata una forma leggibile:
      // "linea vita", non "line vit".
      const groups = new Map<string, { display: string; pages: CrawledUrl[] }>();

      for (const page of analyzablePages(ctx.indexablePages)) {
        const keyword = page.content?.primaryKeyword;
        // Solo locuzioni di almeno due parole: su una parola sola la coincidenza fra pagine
        // dello stesso sito è fisiologica e produrrebbe soltanto rumore.
        if (!keyword || keyword.split(' ').length < 2) continue;
        // Raggruppate sulla forma ridotta: due pagine che dicono "linea vita" e "linee vita"
        // competono sulla stessa query, non su due diverse.
        const key = stemTokens(tokenize(keyword));
        const bucket = groups.get(key);
        if (bucket) bucket.pages.push(page);
        else groups.set(key, { display: keyword, pages: [page] });
      }

      const urls: IssueUrl[] = [];
      for (const group of groups.values()) {
        if (group.pages.length < 2) continue;
        for (const page of group.pages) {
          urls.push({
            url: page.url,
            evidence:
              '"' + truncate(group.display, 40) + '" — contesa fra ' + group.pages.length + ' pagine',
          });
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },

  // ── Leggibilità ────────────────────────────────────────────────────────────
  {
    id: 'hard-to-read',
    title: 'Testi difficili da leggere',
    category: 'content',
    severity: 'low',
    effort: 'high',
    description:
      'Pagine con indice Gulpease sotto ' +
      MIN_GULPEASE +
      ', la soglia sotto la quale il testo risulta impegnativo anche per un lettore con diploma ' +
      'di scuola media. Il Gulpease è l’equivalente italiano del Flesch, calibrato sulla nostra lingua.',
    seoImpact:
      'Un testo faticoso riduce il tempo di permanenza e la probabilità che l’utente completi ' +
      'la lettura o l’azione. Sono segnali comportamentali che incidono sulla resa organica della pagina.',
    recommendation:
      'Spezza i periodi lunghi, riduci le subordinate, preferisci parole comuni ai tecnicismi ' +
      'quando esistono, e usa elenchi puntati per le sequenze.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => {
          const content = p.content;
          if (isListingPage(p)) return false;
          return (
            content !== null &&
            content.readability.words >= MIN_WORDS_FOR_ANALYSIS &&
            content.readability.gulpease < MIN_GULPEASE
          );
        })
        .map((p) => ({
          url: p.url,
          evidence:
            'Gulpease ' +
            (p.content?.readability.gulpease ?? 0) +
            ' (' +
            readabilityLabel(p.content?.readability.gulpease ?? 0) +
            ')',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'long-sentences',
    title: 'Frasi troppo lunghe',
    category: 'content',
    severity: 'low',
    effort: 'medium',
    description:
      'Pagine con frasi di oltre ' + MAX_SENTENCE_WORDS + ' parole in media.',
    seoImpact:
      'Le frasi lunghe abbassano la comprensione soprattutto da mobile, dove lo schermo stretto ' +
      'spezza il periodo su molte righe e il lettore perde il filo.',
    recommendation:
      'Punta a una media di 15-20 parole per frase. Dividi i periodi che contengono più di una ' +
      'idea e sostituisci le subordinate con frasi indipendenti.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => {
          const content = p.content;
          if (isListingPage(p)) return false;
          return (
            content !== null &&
            content.readability.words >= MIN_WORDS_FOR_ANALYSIS &&
            content.readability.avgSentenceWords > MAX_SENTENCE_WORDS
          );
        })
        .map((p) => ({
          url: p.url,
          evidence:
            (p.content?.readability.avgSentenceWords ?? 0) +
            ' parole per frase su ' +
            (p.content?.readability.sentences ?? 0) +
            ' frasi',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },

  // ── Struttura degli heading ────────────────────────────────────────────────
  {
    id: 'heading-hierarchy-skip',
    title: 'Salti nella gerarchia degli heading',
    category: 'headings',
    severity: 'low',
    effort: 'low',
    description:
      'La sequenza degli heading salta uno o più livelli, per esempio un H2 seguito direttamente ' +
      'da un H4.',
    seoImpact:
      'Google e gli screen reader ricostruiscono la struttura del contenuto dalla gerarchia degli ' +
      'heading: con i livelli saltati la struttura risulta ambigua e le sezioni perdono il loro ' +
      'rapporto di subordinazione.',
    recommendation:
      'Usa i livelli in sequenza (H1 → H2 → H3) scegliendoli in base alla gerarchia del contenuto, ' +
      'non alla dimensione del carattere: per quella esiste il CSS.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.htmlPages) {
        const skips = page.content?.outlineProblems.filter((p) => p.kind === 'skip') ?? [];
        if (skips.length === 0) continue;
        urls.push({
          url: page.url,
          evidence: truncate(skips.map((s) => s.detail).join(' · '), 110),
        });
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'empty-headings',
    title: 'Heading vuoti',
    category: 'headings',
    severity: 'low',
    effort: 'low',
    description:
      'Tag heading privi di testo, quasi sempre usati dai page builder come spaziatori o ' +
      'contenitori grafici.',
    seoImpact:
      'Introducono nodi privi di significato nella struttura del documento e possono spezzare la ' +
      'gerarchia delle sezioni reali.',
    recommendation:
      'Rimuovi i tag heading vuoti dal markup e ottieni la spaziatura con il CSS.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.htmlPages) {
        const empties = page.content?.outlineProblems.filter((p) => p.kind === 'empty') ?? [];
        if (empties.length === 0) continue;
        urls.push({ url: page.url, evidence: empties.map((e) => e.detail).join(', ') });
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
];
