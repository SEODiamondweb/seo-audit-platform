import { truncate } from '../../utils/text';
import { normalizeUrl } from '../../utils/url';
import type { CrawledUrl } from '../../crawler/types';
import type { IssueUrl, Rule } from '../types';

const TITLE_MAX = 60;
const TITLE_MIN = 30;
const DESCRIPTION_MAX = 160;
const DESCRIPTION_MIN = 70;

/** Raggruppa le pagine per un valore normalizzato, restituendo solo i gruppi con duplicati. */
function duplicateGroups(
  pages: CrawledUrl[],
  getValue: (page: CrawledUrl) => string | null,
): Map<string, CrawledUrl[]> {
  const groups = new Map<string, CrawledUrl[]>();
  for (const page of pages) {
    const raw = getValue(page);
    if (!raw) continue;
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(page);
    else groups.set(key, [page]);
  }
  for (const [key, bucket] of groups) {
    if (bucket.length < 2) groups.delete(key);
  }
  return groups;
}

const HREFLANG_PATTERN = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i;

export const metadataRules: Rule[] = [
  // ── Metadata ───────────────────────────────────────────────────────────────
  {
    id: 'missing-title',
    title: 'Pagine senza tag title',
    category: 'metadata',
    severity: 'critical',
    effort: 'low',
    description: 'Pagine indicizzabili in cui il tag <title> è assente o vuoto.',
    seoImpact:
      'Il title è il fattore on-page più importante e costituisce il link cliccabile in SERP. Senza title Google genera uno snippet arbitrario e la pagina perde rilevanza sulle query target.',
    recommendation:
      'Assegna a ogni pagina un title unico di 50-60 caratteri che contenga la keyword principale in apertura e il nome del brand in coda.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => !p.title || p.title.trim() === '')
        .map((p) => ({ url: p.url, evidence: 'Tag title assente o vuoto' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'duplicate-title',
    title: 'Title duplicati',
    category: 'metadata',
    severity: 'high',
    effort: 'medium',
    description: 'Piu pagine indicizzabili condividono esattamente lo stesso tag title.',
    seoImpact:
      'Google fatica a distinguere quale pagina mostrare per una query: le pagine competono fra loro (keyword cannibalization) e nessuna raggiunge il massimo potenziale.',
    recommendation:
      'Rendi ogni title unico differenziandolo sull’intento specifico della pagina. Per archivi e paginazioni includi il numero di pagina o il filtro attivo.',
    evaluate(ctx) {
      const groups = duplicateGroups(ctx.indexablePages, (p) => p.title);
      const urls: IssueUrl[] = [];
      for (const [value, bucket] of groups) {
        for (const page of bucket) {
          urls.push({
            url: page.url,
            evidence: '"' + truncate(value, 60) + '" (' + bucket.length + ' pagine)',
          });
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'title-too-long',
    title: 'Title troppo lunghi',
    category: 'metadata',
    severity: 'low',
    effort: 'low',
    description:
      'Title che superano i ' + TITLE_MAX + ' caratteri e vengono probabilmente troncati in SERP.',
    seoImpact:
      'Il troncamento nasconde la parte finale del messaggio e riduce il CTR; se la keyword resta fuori dalla parte visibile, l’annuncio organico perde pertinenza percepita.',
    recommendation:
      'Riduci a 50-60 caratteri anteponendo la parte più rilevante e accorciando o rimuovendo il suffisso di brand nelle pagine profonde.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => p.titleLength > TITLE_MAX)
        .map((p) => ({ url: p.url, evidence: p.titleLength + ' caratteri: ' + truncate(p.title ?? '', 70) }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'title-too-short',
    title: 'Title troppo corti',
    category: 'metadata',
    severity: 'low',
    effort: 'low',
    description: 'Title sotto i ' + TITLE_MIN + ' caratteri, che non sfruttano lo spazio disponibile in SERP.',
    seoImpact:
      'Un title troppo sintetico copre poche varianti di query e comunica meno valore rispetto ai concorrenti, con impatto sul CTR.',
    recommendation:
      'Arricchisci il title con un modificatore utile (categoria, località, beneficio, anno) mantenendoti entro i 60 caratteri.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => p.titleLength > 0 && p.titleLength < TITLE_MIN)
        .map((p) => ({ url: p.url, evidence: p.titleLength + ' caratteri: ' + truncate(p.title ?? '', 70) }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'missing-meta-description',
    title: 'Pagine senza meta description',
    category: 'metadata',
    severity: 'medium',
    effort: 'low',
    description: 'Pagine indicizzabili prive del meta tag description.',
    seoImpact:
      'Google genera automaticamente lo snippet estraendo testo dalla pagina: il messaggio non è controllato e il CTR organico ne risente.',
    recommendation:
      'Scrivi una description di 120-155 caratteri per ogni pagina strategica, con la proposta di valore e una call to action implicita.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => !p.metaDescription || p.metaDescription.trim() === '')
        .map((p) => ({ url: p.url, evidence: 'Meta description assente' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'duplicate-meta-description',
    title: 'Meta description duplicate',
    category: 'metadata',
    severity: 'medium',
    effort: 'medium',
    description: 'Piu pagine indicizzabili usano la stessa meta description.',
    seoImpact:
      'Snippet identici in SERP riducono la distintività dei risultati e segnalano contenuti poco differenziati.',
    recommendation:
      'Personalizza la description per pagina; dove i contenuti sono generati in massa, usa un template dinamico che includa attributi specifici del contenuto.',
    evaluate(ctx) {
      const groups = duplicateGroups(ctx.indexablePages, (p) => p.metaDescription);
      const urls: IssueUrl[] = [];
      for (const [value, bucket] of groups) {
        for (const page of bucket) {
          urls.push({
            url: page.url,
            evidence: '"' + truncate(value, 60) + '" (' + bucket.length + ' pagine)',
          });
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'meta-description-length',
    title: 'Meta description fuori dalla lunghezza ottimale',
    category: 'metadata',
    severity: 'low',
    effort: 'low',
    description:
      'Description sotto i ' + DESCRIPTION_MIN + ' o sopra i ' + DESCRIPTION_MAX + ' caratteri.',
    seoImpact:
      'Le description troppo lunghe vengono troncate, quelle troppo corte lasciano spazio inutilizzato: in entrambi i casi il CTR peggiora.',
    recommendation: 'Riscrivi le description nell’intervallo 120-155 caratteri.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter(
          (p) =>
            p.metaDescriptionLength > 0 &&
            (p.metaDescriptionLength > DESCRIPTION_MAX || p.metaDescriptionLength < DESCRIPTION_MIN),
        )
        .map((p) => ({
          url: p.url,
          evidence:
            p.metaDescriptionLength +
            ' caratteri (' +
            (p.metaDescriptionLength > DESCRIPTION_MAX ? 'troppo lunga' : 'troppo corta') +
            ')',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'missing-open-graph',
    title: 'Pagine senza tag Open Graph',
    category: 'metadata',
    severity: 'low',
    effort: 'low',
    description: 'Pagine indicizzabili senza og:title oppure senza og:image.',
    seoImpact:
      'Le anteprime di condivisione su social e app di messaggistica risultano povere o sbagliate, riducendo i click sui link condivisi.',
    recommendation:
      'Aggiungi og:title, og:description, og:image (1200x630) e og:url a tutti i template principali.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => !p.ogTitle || !p.ogImage)
        .map((p) => ({
          url: p.url,
          evidence: !p.ogTitle && !p.ogImage ? 'og:title e og:image assenti' : !p.ogTitle ? 'og:title assente' : 'og:image assente',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },

  // ── Heading ────────────────────────────────────────────────────────────────
  {
    id: 'missing-h1',
    title: 'Pagine senza H1',
    category: 'headings',
    severity: 'high',
    effort: 'low',
    description: 'Pagine indicizzabili in cui non è presente alcun tag H1 con testo.',
    seoImpact:
      'L’H1 dichiara l’argomento principale della pagina a motori e screen reader: la sua assenza indebolisce la pertinenza tematica e l’accessibilità.',
    recommendation:
      'Inserisci un unico H1 descrittivo per pagina, coerente con il title ma non identico, contenente la keyword principale.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => p.h1.length === 0)
        .map((p) => ({ url: p.url, evidence: 'Nessun H1 trovato' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'multiple-h1',
    title: 'Pagine con più di un H1',
    category: 'headings',
    severity: 'low',
    effort: 'low',
    description: 'Pagine che contengono due o più tag H1.',
    seoImpact:
      'Piu H1 diluiscono il segnale tematico e spesso indicano un uso del markup per motivi grafici anziche semantici.',
    recommendation:
      'Mantieni un solo H1 per pagina e converti gli altri in H2/H3 rispettando la gerarchia dei contenuti.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => p.h1.length > 1)
        .map((p) => ({ url: p.url, evidence: p.h1.length + ' tag H1: ' + truncate(p.h1.join(' | '), 90) }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'duplicate-h1',
    title: 'H1 duplicati su pagine diverse',
    category: 'headings',
    severity: 'medium',
    effort: 'medium',
    description: 'Pagine indicizzabili differenti che usano lo stesso testo nell’H1.',
    seoImpact:
      'Indica contenuti percepiti come sovrapponibili e favorisce la cannibalizzazione fra pagine dello stesso sito.',
    recommendation:
      'Differenzia gli H1 sull’intento specifico di ogni pagina; se i contenuti sono realmente equivalenti valuta di consolidarli in una sola pagina.',
    evaluate(ctx) {
      const groups = duplicateGroups(ctx.indexablePages, (p) => p.h1[0] ?? null);
      const urls: IssueUrl[] = [];
      for (const [value, bucket] of groups) {
        for (const page of bucket) {
          urls.push({
            url: page.url,
            evidence: '"' + truncate(value, 60) + '" (' + bucket.length + ' pagine)',
          });
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'missing-h2',
    title: 'Pagine con contenuto esteso senza sottotitoli H2',
    category: 'headings',
    severity: 'low',
    effort: 'low',
    description: 'Pagine con oltre 300 parole che non usano alcun H2 per strutturare il testo.',
    seoImpact:
      'Un testo senza gerarchia è più difficile da scansionare per gli utenti e offre a Google meno appigli per i passage ranking e i featured snippet.',
    recommendation:
      'Suddividi il contenuto in sezioni tematiche introdotte da H2 che riprendano le domande e le varianti di ricerca degli utenti.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => p.wordCount > 300 && p.h2.length === 0)
        .map((p) => ({ url: p.url, evidence: p.wordCount + ' parole, 0 H2' }));
      return urls.length > 0 ? { urls } : null;
    },
  },

  // ── Hreflang ───────────────────────────────────────────────────────────────
  {
    id: 'hreflang-invalid-code',
    title: 'Codici hreflang non validi',
    category: 'hreflang',
    severity: 'medium',
    effort: 'low',
    description:
      'Attributi hreflang che non rispettano il formato ISO 639-1 (lingua) ed eventualmente ISO 3166-1 alpha-2 (paese).',
    seoImpact:
      'Un codice non valido viene ignorato da Google: la relazione fra le versioni linguistiche non viene riconosciuta e agli utenti può essere mostrata la lingua sbagliata.',
    recommendation:
      'Usa il formato lingua o lingua-PAESE (it, it-IT, en-GB) e x-default per la versione di fallback. Il codice paese non va mai usato da solo.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.htmlPages) {
        const invalid = page.hreflang.filter((h) => !HREFLANG_PATTERN.test(h.lang));
        if (invalid.length > 0) {
          urls.push({
            url: page.url,
            evidence: 'Codici non validi: ' + truncate(invalid.map((h) => h.lang).join(', '), 90),
          });
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'hreflang-missing-return-link',
    title: 'Hreflang senza link di ritorno',
    category: 'hreflang',
    severity: 'high',
    effort: 'medium',
    description:
      'Una pagina dichiara un alternate hreflang verso un altra URL del sito, ma quella URL non dichiara a sua volta la relazione inversa.',
    seoImpact:
      'Le annotazioni hreflang senza reciprocità vengono scartate da Google: il cluster linguistico non viene formato e le versioni competono fra loro.',
    recommendation:
      'Fai in modo che ogni pagina del cluster elenchi tutte le versioni linguistiche, se stessa compresa, con le stesse URL assolute e canoniche.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.htmlPages) {
        if (page.hreflang.length === 0) continue;
        for (const ref of page.hreflang) {
          if (ref.lang.toLowerCase() === 'x-default') continue;
          const targetUrl = normalizeUrl(ref.href, page.url);
          if (!targetUrl) continue;
          const target = ctx.pagesByUrl.get(targetUrl);
          if (!target) continue;
          const hasReturn = target.hreflang.some((back) => {
            const backUrl = normalizeUrl(back.href, target.url);
            return backUrl === page.url;
          });
          if (!hasReturn) {
            urls.push({
              url: page.url,
              evidence: 'Nessun ritorno da ' + truncate(targetUrl, 70) + ' (' + ref.lang + ')',
            });
            break;
          }
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'hreflang-broken-target',
    title: 'Hreflang che punta a URL non indicizzabili',
    category: 'hreflang',
    severity: 'medium',
    effort: 'medium',
    description:
      'Annotazioni hreflang che puntano a URL in errore, in redirect o escluse dall’indice.',
    seoImpact:
      'Il cluster linguistico risulta incoerente e viene ignorato, con il rischio di mostrare la versione sbagliata nei mercati target.',
    recommendation:
      'Aggiorna gli hreflang verso le URL finali in stato 200 e indicizzabili, allineandoli ai canonical delle rispettive pagine.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.htmlPages) {
        for (const ref of page.hreflang) {
          const targetUrl = normalizeUrl(ref.href, page.url);
          if (!targetUrl) continue;
          const target = ctx.pagesByUrl.get(targetUrl);
          if (!target || target.indexable) continue;
          urls.push({
            url: page.url,
            evidence:
              ref.lang + ' -> ' + truncate(targetUrl, 60) + ' (' + target.indexabilityStatus + ')',
          });
          break;
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'hreflang-missing-x-default',
    title: 'Cluster hreflang senza x-default',
    category: 'hreflang',
    severity: 'low',
    effort: 'low',
    description:
      'Pagine con annotazioni hreflang che non dichiarano una versione x-default di fallback.',
    seoImpact:
      'Per gli utenti la cui lingua non è coperta dal cluster, Google sceglie arbitrariamente una versione: senza x-default il controllo e nullo.',
    recommendation:
      'Aggiungi <link rel="alternate" hreflang="x-default" href="..."> puntando alla versione internazionale o al selettore di lingua.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.htmlPages
        .filter(
          (p) =>
            p.hreflang.length > 0 &&
            !p.hreflang.some((h) => h.lang.toLowerCase() === 'x-default'),
        )
        .map((p) => ({ url: p.url, evidence: p.hreflang.length + ' alternate, nessun x-default' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
];
