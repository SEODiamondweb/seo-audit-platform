import { isStopword } from './stopwords';
import { isLocation } from './locations';
import { stem, stemTokens } from './stemmer';

export interface KeywordStat {
  /** La locuzione, in minuscolo e senza punteggiatura. */
  term: string;
  /** Numero di parole che la compongono (1, 2 o 3). */
  words: number;
  count: number;
  /** Occorrenze sul totale delle parole del testo, 0..1 */
  density: number;
  /**
   * Punteggio di rilevanza. Non è la sola frequenza: le locuzioni di 2-3 parole valgono di più
   * perché identificano un intento di ricerca molto più preciso di una parola singola.
   */
  score: number;
}

export interface KeywordPlacement {
  inTitle: boolean;
  inH1: boolean;
  inDescription: boolean;
  inUrl: boolean;
  inImageAlt: boolean;
  /** Numero di collocazioni presenti su cinque. */
  coverage: number;
}

const MAX_NGRAM = 3;
const MIN_TERM_LENGTH = 3;

/** Divide il testo in parole normalizzate, conservando lettere accentate e cifre. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/** Normalizza una stringa qualsiasi per un confronto insensibile a punteggiatura e accenti di stile. */
export function normalizeForMatch(text: string): string {
  return tokenize(text).join(' ');
}

/**
 * Estrae le locuzioni chiave più rilevanti dal testo.
 *
 * Vengono scartate: le parole singole troppo corte o presenti nelle stopword, e le locuzioni
 * che iniziano o finiscono con una stopword ("della casa"), che non sono chiavi plausibili.
 * Bigrammi e trigrammi richiedono almeno due occorrenze, altrimenti qualsiasi frase del testo
 * comparirebbe fra i risultati.
 */
export interface ExtractOptions {
  limit?: number;
  /**
   * Testo degli heading di sezione (H2-H6). I termini che vi compaiono ricevono un bonus:
   * sono quelli che l'autore ha scelto per intitolare le parti del contenuto, quindi
   * descrivono l'argomento meglio della sola frequenza.
   *
   * L'H1 e il title sono volutamente esclusi: su di essi il report verifica la coerenza,
   * e usarli qui renderebbe quel controllo circolare, sempre soddisfatto per costruzione.
   */
  headingsText?: string;
}

export function extractKeywords(text: string, options: ExtractOptions = {}): KeywordStat[] {
  const limit = options.limit ?? 15;
  const tokens = tokenize(text);
  const total = tokens.length;
  if (total === 0) return [];

  const headingTokens = new Set(
    options.headingsText ? tokenize(options.headingsText).filter((t) => !isStopword(t)) : [],
  );

  /**
   * Le occorrenze sono raggruppate sulla forma ridotta, non su quella scritta: cosí
   * "linea vita" e "linee vita" contano come lo stesso argomento invece di dividersi
   * le occorrenze e perdere entrambe la classifica. Delle forme incontrate si tiene traccia
   * per poter poi mostrare nel report quella effettivamente più usata nel testo.
   */
  const counts = new Map<
    string,
    { count: number; words: number; surfaces: Map<string, number> }
  >();

  for (let n = 1; n <= MAX_NGRAM; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const parts = tokens.slice(i, i + n);

      const first = parts[0] as string;
      const last = parts[n - 1] as string;
      // Le località si comportano come stopword: non aprono né chiudono una locuzione e non
      // valgono da sole. Una città è dove il servizio si svolge, non di cosa la pagina parla.
      if (isStopword(first) || isStopword(last)) continue;
      if (isLocation(first) || isLocation(last)) continue;
      if (parts.some((p) => p.length < 2)) continue;
      if (n === 1 && first.length < MIN_TERM_LENGTH) continue;
      // Una locuzione fatta solo di cifre non è una keyword, e nemmeno una che inizia o
      // finisce con un numero: "2026 newsindice" nasce da una data accanto a una categoria.
      if (parts.every((p) => /^\d+$/.test(p))) continue;
      if (/^\d+$/.test(first) || /^\d+$/.test(last)) continue;

      const surface = parts.join(' ');
      const key = stemTokens(parts);

      let entry = counts.get(key);
      if (!entry) {
        entry = { count: 0, words: n, surfaces: new Map() };
        counts.set(key, entry);
      }
      entry.count += 1;
      entry.surfaces.set(surface, (entry.surfaces.get(surface) ?? 0) + 1);
    }
  }

  const stats: KeywordStat[] = [];
  for (const [, { count, words, surfaces }] of counts) {
    if (count < 2) continue;

    // Fra le varianti raccolte si mostra quella scritta più spesso.
    const term = [...surfaces.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    const parts = term.split(' ');
    const contentWords = parts.filter((p) => !isStopword(p));
    // Il bonus vale in proporzione a quante parole piene della locuzione ricorrono negli heading.
    const inHeadings =
      contentWords.length > 0
        ? contentWords.filter((p) => headingTokens.has(p)).length / contentWords.length
        : 0;

    stats.push({
      term,
      words,
      count,
      density: count / total,
      // Il moltiplicatore sulle parole premia la specificità ("consulenza seo milano" batte
      // "seo"); quello sugli heading premia ciò che l'autore ha dichiarato come struttura.
      score: count * (1 + 0.8 * (words - 1)) * (1 + 1.5 * inHeadings),
    });
  }

  stats.sort((a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term));
  return stats.slice(0, limit);
}

/** Verifica dove compare la keyword principale fra le collocazioni che contano per la SEO. */
export function keywordPlacement(
  keyword: string,
  page: {
    title: string | null;
    h1: string | null;
    description: string | null;
    url: string;
    imageAlts: string[];
  },
): KeywordPlacement {
  // Il confronto avviene sulle forme ridotte: un title che dice "Linee vita" contiene
  // l'argomento "linea vita", e trattarli come diversi sarebbe un falso positivo.
  // Gli spazi ai bordi impongono il confine di parola, cosí "line" non risulta dentro "lineare".
  const needle = ' ' + stemTokens(tokenize(keyword)) + ' ';

  const contains = (haystack: string | null): boolean => {
    if (!haystack || needle.trim() === '') return false;
    return (' ' + stemTokens(tokenize(haystack)) + ' ').includes(needle);
  };

  let slug = '';
  try {
    slug = decodeURIComponent(new URL(page.url).pathname);
  } catch {
    slug = page.url;
  }

  // Gli slug omettono quasi sempre le preposizioni: "seo per aziende" diventa
  // /consulenza-seo-aziende/. Un confronto letterale darebbe un falso negativo, quindi
  // si verifica che tutte le parole piene della keyword siano presenti nel percorso.
  const slugStems = new Set(tokenize(slug).map(stem));
  const contentWords = tokenize(keyword)
    .filter((word) => !isStopword(word))
    .map(stem);
  const inUrl =
    contentWords.length > 0 && contentWords.every((word) => slugStems.has(word));

  const placement = {
    inTitle: contains(page.title),
    inH1: contains(page.h1),
    inDescription: contains(page.description),
    inUrl,
    inImageAlt: page.imageAlts.some((alt) => contains(alt)),
  };

  const coverage = Object.values(placement).filter(Boolean).length;
  return { ...placement, coverage };
}

/**
 * Quanto due testi condividono in termini di parole significative, 0..1 (Jaccard).
 * Usata per capire se title e H1 parlano davvero della stessa cosa.
 */
export function overlapRatio(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  // Anche qui il confronto è sulle forme ridotte: "copertura" e "coperture" sono la stessa parola.
  const significant = (text: string): Set<string> =>
    new Set(
      tokenize(text)
        .filter((t) => !isStopword(t) && t.length >= MIN_TERM_LENGTH)
        .map(stem),
    );

  const setA = significant(a);
  const setB = significant(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;

  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}
