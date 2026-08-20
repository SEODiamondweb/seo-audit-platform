export interface ReadabilityStats {
  words: number;
  sentences: number;
  letters: number;
  paragraphs: number;
  avgSentenceWords: number;
  avgParagraphWords: number;
  /**
   * Indice Gulpease, 0-100: più alto, più facile.
   * È l'equivalente italiano del Flesch, ma calibrato sull'italiano perché usa le lettere
   * al posto delle sillabe — sulle nostre parole, mediamente più lunghe, il Flesch sottostima
   * sistematicamente la leggibilità.
   *
   * Riferimenti: sotto 40 il testo è difficile per chi ha la licenza media, sotto 60 lo è per
   * chi ha la licenza elementare. Per un sito rivolto al pubblico si punta a 50-60.
   */
  gulpease: number;
}

const SENTENCE_SEPARATORS = /[.!?…]+(?=\s|$)/g;

export function computeReadability(text: string, paragraphs: number): ReadabilityStats {
  const trimmed = text.trim();

  const words = trimmed === '' ? 0 : trimmed.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const letters = (trimmed.match(/\p{L}/gu) ?? []).length;

  const sentenceParts = trimmed
    .split(SENTENCE_SEPARATORS)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // Un testo senza punteggiatura finale conta comunque come una frase.
  const sentences = Math.max(sentenceParts.length, words > 0 ? 1 : 0);

  const gulpease =
    words > 0
      ? Math.max(0, Math.min(100, Math.round(89 + (300 * sentences - 10 * letters) / words)))
      : 0;

  return {
    words,
    sentences,
    letters,
    paragraphs,
    avgSentenceWords: sentences > 0 ? Math.round(words / sentences) : 0,
    avgParagraphWords: paragraphs > 0 ? Math.round(words / paragraphs) : 0,
    gulpease,
  };
}

export function readabilityLabel(gulpease: number): string {
  if (gulpease >= 80) return 'Molto facile';
  if (gulpease >= 60) return 'Facile';
  if (gulpease >= 40) return 'Impegnativo';
  if (gulpease >= 20) return 'Difficile';
  return 'Molto difficile';
}
