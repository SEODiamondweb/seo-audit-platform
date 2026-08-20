import { keywordPlacement, tokenize } from './keywords';
import { stemTokens } from './stemmer';
import type { ContentAnalysis, KeywordStat } from './index';

export interface RefinablePage {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  images: { alt: string | null }[];
  content: ContentAnalysis | null;
}

/**
 * Quota di pagine oltre la quale una locuzione è considerata testo di contorno.
 * Con il 60% si eliminano menù, footer e informative senza toccare i temi ricorrenti
 * di un sito verticale, dove è normale che la stessa keyword torni su molte pagine.
 */
const BOILERPLATE_RATIO = 0.6;

/** Sotto questo numero di pagine la frequenza documentale non è statisticamente utile. */
const MIN_PAGES_FOR_IDF = 8;

/**
 * Riordina le keyword di ogni pagina pesandole con l'inverse document frequency.
 *
 * L'estrazione per singola pagina non può sapere che "richiedi un preventivo" compare in fondo
 * a tutte le pagine del sito: vista da sola, è una locuzione frequente e quindi rilevante.
 * Solo confrontando le pagine fra loro emerge che non distingue nulla.
 *
 * Le locuzioni presenti su oltre il 60% delle pagine vengono scartate; le altre vengono
 * riordinate per frequenza pesata sulla rarità, così l'argomento che emerge è quello che
 * distingue la pagina dalle altre. Placement e densità vengono ricalcolati di conseguenza.
 */
export function refineKeywords(pages: RefinablePage[]): void {
  const analyzable = pages.filter((page) => page.content && page.content.keywords.length > 0);
  if (analyzable.length < MIN_PAGES_FOR_IDF) return;

  const documentFrequency = new Map<string, number>();
  for (const page of analyzable) {
    const seen = new Set<string>();
    for (const keyword of page.content!.keywords) {
      // La chiave e la forma ridotta: pagine diverse possono scrivere "linea vita" e
      // "linee vita", ma per la frequenza documentale sono la stessa locuzione.
      const key = stemTokens(tokenize(keyword.term));
      if (seen.has(key)) continue;
      seen.add(key);
      documentFrequency.set(key, (documentFrequency.get(key) ?? 0) + 1);
    }
  }

  const total = analyzable.length;
  const maxDocuments = Math.max(1, Math.floor(total * BOILERPLATE_RATIO));

  for (const page of analyzable) {
    const content = page.content as ContentAnalysis;

    const reranked: KeywordStat[] = content.keywords
      .filter((keyword) => (documentFrequency.get(stemTokens(tokenize(keyword.term))) ?? 0) <= maxDocuments)
      .map((keyword) => {
        const df = documentFrequency.get(stemTokens(tokenize(keyword.term))) ?? 1;
        const idf = Math.log(total / df) + 1;
        return { ...keyword, score: keyword.score * idf };
      })
      .sort((a, b) => b.score - a.score || b.count - a.count);

    // Se il filtro azzera tutto, la pagina non ha contenuto proprio: si lascia l'elenco
    // originale piuttosto che dichiararla senza argomento.
    if (reranked.length === 0) continue;

    content.keywords = reranked;

    const primary = reranked[0] as KeywordStat;
    content.primaryKeyword = primary.term;
    content.primaryDensity = primary.density;
    content.placement = keywordPlacement(primary.term, {
      title: page.title,
      h1: page.h1[0] ?? null,
      description: page.metaDescription,
      url: page.url,
      imageAlts: page.images.map((img) => img.alt ?? '').filter((alt) => alt !== ''),
    });
  }
}
