/**
 * Riduzione morfologica leggera per l'italiano.
 *
 * Non è un lemmatizzatore: serve solo a far coincidere le varianti della stessa parola quando
 * si raggruppano le keyword, cosí che "linea vita" e "linee vita" risultino lo stesso argomento.
 *
 * La forma mostrata nel report resta quella realmente scritta nel testo: qui si calcola solo la
 * chiave di raggruppamento, che non deve essere leggibile ma stabile.
 *
 * Regole applicate, nell'ordine:
 *  - le uscite palatali si riducono alla consonante dura, cosí "amiche" e "amici" collassano
 *    su "amic" insieme ad "amica" e "amico";
 *  - cade la vocale finale, che in italiano è quasi sempre la desinenza di numero e genere.
 *
 * Le parole corte restano intatte: accorciare "via" o "uso" produrrebbe collisioni fra termini
 * che non hanno alcun rapporto.
 */

const MIN_STEM_LENGTH = 4;

const PALATAL_ENDINGS: [RegExp, string][] = [
  [/(chi|che)$/, 'c'],
  [/(ghi|ghe)$/, 'g'],
  [/(sci|sce)$/, 'sc'],
  [/(gli|glie)$/, 'gl'],
];

export function stem(word: string): string {
  if (word.length < MIN_STEM_LENGTH) return word;

  for (const [pattern, replacement] of PALATAL_ENDINGS) {
    if (pattern.test(word)) {
      const reduced = word.replace(pattern, replacement);
      return reduced.length >= 3 ? reduced : word;
    }
  }

  if (/[aeiou]$/.test(word)) {
    const reduced = word.slice(0, -1);
    return reduced.length >= 3 ? reduced : word;
  }

  return word;
}

/** Chiave di raggruppamento di una locuzione già tokenizzata. */
export function stemTokens(tokens: readonly string[]): string {
  return tokens.map(stem).join(' ');
}
